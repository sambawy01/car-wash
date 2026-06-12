import { buildVassiliSystemPrompt } from "./prompt";
import {
  TOOLS,
  describeMutation,
  executeTool,
  requiresConfirmation,
  validateMutationArgs,
  type ToolContext,
} from "./tools";
import {
  appendAudit,
  appendHistory,
  createPendingAction,
  loadHistory,
} from "./state";

/**
 * Vassili's agent loop — Ollama chat with NATIVE tool calling.
 *
 * Verified empirically against deepseek-v4-flash:cloud (Ollama 0.30):
 * the model advertises the "tools" capability, returns
 * `message.tool_calls[].function = { name, arguments: object }`, and accepts
 * tool results as `{ role: "tool", tool_name, content }` messages.
 *
 * Loop shape:
 * - ≤ MAX_TOOL_ROUNDS rounds (each round = one model call, possibly with
 *   several tool calls). Read-only tools execute inline; the FIRST mutating
 *   tool call short-circuits the loop into a pending action + confirmation
 *   keyboard (the model never gets to see mutating results directly — those
 *   arrive via the callback handler editing the Telegram message).
 * - Overall budget: callers pass an absolute `deadlineAt` (the webhook route
 *   derives it from its maxDuration). No NEW model call starts with less
 *   than DEADLINE_MIN_MODEL_MS remaining, and each call's own timeout is
 *   capped so it cannot run past the deadline minus the reply reserve —
 *   otherwise the function gets killed mid-run and Telegram redelivers the
 *   update, double-running the agent.
 */

const MAX_TOOL_ROUNDS = 4;
const UPSTREAM_TIMEOUT_MS = 30_000;
const NUM_PREDICT = 700;
/** Don't START a model call with less budget than this before the deadline. */
const DEADLINE_MIN_MODEL_MS = 20_000;
/** Time reserved after the last model call to send the Telegram reply. */
const REPLY_RESERVE_MS = 8_000;

interface OllamaToolCall {
  function: { name: string; arguments?: Record<string, unknown> | string };
}

interface OllamaChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

async function callOllama(
  messages: OllamaChatMessage[],
  timeoutMs: number = UPSTREAM_TIMEOUT_MS
): Promise<OllamaChatMessage> {
  const apiKey = process.env.OLLAMA_API_KEY;
  const baseUrl = apiKey
    ? "https://ollama.com/api/chat"
    : "http://localhost:11434/api/chat";
  const model = process.env.OLLAMA_MODEL || "deepseek-v4-flash:cloud";

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      stream: false,
      options: { num_predict: NUM_PREDICT },
      messages,
      tools: TOOLS,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    throw new Error(`Ollama upstream error ${res.status}: ${detail}`);
  }
  const data = (await res.json()) as { message?: OllamaChatMessage };
  if (!data.message) throw new Error("Ollama returned no message");
  return data.message;
}

function parseArgs(call: OllamaToolCall): Record<string, unknown> {
  const raw = call.function.arguments;
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object")
        return parsed as Record<string, unknown>;
    } catch {
      // fall through
    }
  }
  return {};
}

export type AgentOutcome =
  | { kind: "text"; text: string }
  | {
      kind: "confirm";
      /** Text to send above the [Confirm | Cancel] keyboard. */
      text: string;
      pendingId: string;
    };

/**
 * Run one user message through the agent. Returns either a final text reply
 * or a confirmation request (the caller attaches the inline keyboard).
 * Conversation history is loaded from / persisted to Blob here.
 */
export async function runAgent(
  userText: string,
  ctx: ToolContext,
  opts: { deadlineAt?: number } = {}
): Promise<AgentOutcome> {
  const history = await loadHistory();
  const messages: OllamaChatMessage[] = [
    { role: "system", content: buildVassiliSystemPrompt() },
    // History keeps full tool-call exchanges (see state.ts) — pass through.
    ...history.map(
      (m): OllamaChatMessage => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.tool_name ? { tool_name: m.tool_name } : {}),
      })
    ),
    { role: "user", content: userText },
  ];

  // Most recent validation-refusal error, kept so that when the round budget
  // runs out with no usable model text, the user still sees WHY nothing
  // happened instead of a generic empty-handed shrug.
  let lastRefusal: string | null = null;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const finalRound = round === MAX_TOOL_ROUNDS;

    // Deadline gate: never start a model call that could outlive the route's
    // execution budget (the function would be killed and Telegram would
    // redeliver the update, double-running the agent).
    const remainingMs =
      opts.deadlineAt !== undefined
        ? opts.deadlineAt - Date.now()
        : Number.POSITIVE_INFINITY;
    if (remainingMs < DEADLINE_MIN_MODEL_MS) {
      const text =
        "Sorry — this one is taking me too long to work through. Please try again in a moment.";
      await appendHistory(
        { role: "user", content: userText },
        { role: "assistant", content: text }
      );
      return { kind: "text", text };
    }

    let reply: OllamaChatMessage;
    try {
      reply = await callOllama(
        messages,
        Math.min(UPSTREAM_TIMEOUT_MS, remainingMs - REPLY_RESERVE_MS)
      );
    } catch (error) {
      console.error("[assistant] Model call failed:", error);
      return {
        kind: "text",
        text: "Sorry — my brain is unreachable right now. Please try again in a minute.",
      };
    }

    const toolCalls = reply.tool_calls ?? [];
    if (toolCalls.length === 0 || finalRound) {
      const text =
        (reply.content || "").trim() ||
        (lastRefusal
          ? `I can't do that as asked — ${lastRefusal}. Nothing was queued. Please rephrase and I'll try again.`
          : "Hmm, I came back empty-handed. Could you rephrase that?");
      await appendHistory(
        { role: "user", content: userText },
        { role: "assistant", content: text }
      );
      return { kind: "text", text };
    }

    // Mutating call? → pending action + keyboard, loop ends here.
    let refusedThisRound = false;
    for (const call of toolCalls) {
      const name = call.function?.name ?? "";
      const args = parseArgs(call);
      if (requiresConfirmation(name, args)) {
        // Validate/normalize ONCE — summary and executor must consume the
        // SAME validated object, so what Victoria confirms is exactly what
        // executes. Invalid args (wrong types, empty required strings, bad
        // emails) are REFUSED outright, never queued: a malformed value
        // could render blank on the confirmation card while the executor's
        // String() coercion acts on the real payload (prompt injection).
        const validated = validateMutationArgs(name, args);
        if (!validated.ok) {
          // Don't end the loop with a user-facing refusal over a fixable
          // slip (e.g. '"priceEgp": "abc"'): rounds always remain here
          // (finalRound returned above), so feed REFUSED back as a tool
          // result and let the model self-correct. Victoria only sees a
          // refusal if the round budget runs out without usable text
          // (the lastRefusal fallback above).
          lastRefusal = validated.error;
          await appendAudit({
            chatId: ctx.chatId,
            kind: "tool-refused",
            detail: { tool: name, args, error: validated.error },
          });
          messages.push(reply);
          for (const c of toolCalls) {
            messages.push({
              role: "tool",
              tool_name: c.function?.name ?? "",
              content:
                c === call
                  ? `REFUSED — ${validated.error}. Nothing was queued or executed. Correct the arguments and call the tool again.`
                  : "NOT EXECUTED — another tool call in this turn was refused; correct it and retry.",
            });
          }
          refusedThisRound = true;
          break;
        }
        const summary = describeMutation(name, validated.args);
        const pending = await createPendingAction({
          chatId: ctx.chatId,
          tool: name,
          args: validated.args,
          summary,
        });
        const text = `⚠️ Please confirm:\n${summary}`;
        // Persist the exchange as a REAL tool call (not the prompt text):
        // text-shaped confirmations in history teach the model to imitate
        // text instead of calling tools (observed with deepseek-v4-flash).
        await appendHistory(
          { role: "user", content: userText },
          {
            role: "assistant",
            content: "",
            tool_calls: [{ function: { name, arguments: validated.args } }],
          },
          {
            role: "tool",
            tool_name: name,
            content: `Queued — Victoria was shown a [Confirm | Cancel] button for: ${summary}. The system will report the outcome; do not retry.`,
          }
        );
        await appendAudit({
          chatId: ctx.chatId,
          kind: "pending-created",
          detail: { id: pending.id, tool: name, args: validated.args },
        });
        return { kind: "confirm", text, pendingId: pending.id };
      }
    }
    if (refusedThisRound) continue; // refusal already fed back — next round

    // All read-only — execute and feed results back.
    messages.push(reply);
    for (const call of toolCalls) {
      const name = call.function?.name ?? "";
      const args = parseArgs(call);
      const result = await executeTool(name, args, ctx);
      await appendAudit({
        chatId: ctx.chatId,
        kind: "tool-executed",
        detail: { tool: name, args, result: result.slice(0, 500) },
      });
      messages.push({
        role: "tool",
        tool_name: name,
        content: result.slice(0, 6000),
      });
    }
  }

  // Unreachable (finalRound returns above), but keep TypeScript satisfied.
  return { kind: "text", text: "Something went sideways — please try again." };
}
