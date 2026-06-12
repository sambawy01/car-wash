/**
 * End-to-end verification harness for Vassili (the Telegram assistant).
 *
 * Run from vercel-app/:   npx tsx scripts/verify-vassili.mts
 *
 * What is REAL: Vercel Blob (state/catalog — including product_add/remove,
 * hard-cleaned to byte-identical afterwards), Cal.com READS, Cal.com
 * OUT-OF-OFFICE create+delete (far-future day, removed immediately — the
 * empirical block_time verification), and the Ollama model (local ollama →
 * Ollama Cloud). What is MOCKED at the fetch boundary:
 * - api.telegram.org      → captured (no bot exists yet)
 * - Cal.com BOOKING mutations (confirm/decline/reschedule) → captured
 *   (never touch real bookings)
 * - api.resend.com        → captured (never send real emails; RESEND_API_KEY
 *   is also blanked for belt-and-braces)
 *
 * The script drives the real webhook route handler with synthetic Telegram
 * updates and asserts on the captured outbound calls.
 *
 * PRODUCTION-STATE SAFETY:
 * - telegram/owner.json, telegram/audit.jsonl and catalog/products.json are
 *   snapshotted at start and restored BYTE-IDENTICAL in a `finally` cleanup
 *   (even when the run crashes mid-way).
 * - If an owner record already exists whose chat id is NOT this harness's
 *   synthetic one, the run REFUSES to start (it would unbind the real owner)
 *   unless VASSILI_HARNESS_OVERRIDE=1 is set.
 * - telegram/history.json, telegram/alerts.json, telegram/pending/* and
 *   telegram/claims/* are working state created by the run and are deleted
 *   in cleanup.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- env (before any app import) ---------------------------------------------
for (const line of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
process.env.RESEND_API_KEY = ""; // never send real emails from this harness
process.env.TELEGRAM_BOT_TOKEN = "TEST:fake-token";
process.env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret";

// .env.local pulls ADMIN_PASS as empty — use a harness-controlled value (the
// route only ever compares against the env var, so this tests the mechanism).
if (!process.env.ADMIN_PASS) process.env.ADMIN_PASS = "victoria2026!";
const ADMIN_PASS = process.env.ADMIN_PASS;

// --- fetch interception ------------------------------------------------------------
interface Captured {
  url: string;
  method: string;
  body?: unknown;
  form?: Record<string, { filename?: string; size?: number; text?: string }>;
}
const telegramCalls: Captured[] = [];
const calMutations: Captured[] = [];
const resendCalls: Captured[] = [];
let lastPdf: Buffer | null = null;

/**
 * When non-null, Ollama chat calls are answered from this queue instead of
 * the real model (request bodies captured in ollamaRequests for assertions).
 * Used to script EXACT tool calls — e.g. numbers-as-strings arguments — that
 * the real model can't be forced to emit deterministically.
 */
let scriptedOllama: { message: Record<string, unknown> }[] | null = null;
const ollamaRequests: {
  messages: { role: string; tool_name?: string; content: string }[];
}[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? "GET").toUpperCase();

  if (url.includes("api.telegram.org")) {
    const cap: Captured = { url, method };
    if (init?.body instanceof FormData) {
      cap.form = {};
      for (const [key, value] of init.body.entries()) {
        if (value instanceof Blob) {
          const buf = Buffer.from(await value.arrayBuffer());
          const filename = (value as File).name;
          cap.form[key] = { filename, size: buf.length };
          if (filename?.endsWith(".pdf")) lastPdf = buf;
        } else {
          cap.form[key] = { text: String(value) };
        }
      }
    } else if (typeof init?.body === "string") {
      cap.body = JSON.parse(init.body);
    }
    telegramCalls.push(cap);
    return new Response(
      JSON.stringify({ ok: true, result: { message_id: 4242 } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Cal.com mutations: POST /bookings/<uid>/(confirm|decline|reschedule)
  if (
    method === "POST" &&
    /\/v2\/bookings\/[^/]+\/(confirm|decline|reschedule)$/.test(url)
  ) {
    calMutations.push({
      url,
      method,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify({ status: "success", data: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (
    scriptedOllama !== null &&
    (url.includes("ollama.com/api/chat") || url.includes(":11434/api/chat"))
  ) {
    if (typeof init?.body === "string") {
      ollamaRequests.push(JSON.parse(init.body));
    }
    const next = scriptedOllama.shift();
    if (!next) {
      return new Response(
        JSON.stringify({ error: "scripted Ollama queue exhausted" }),
        { status: 500 }
      );
    }
    return new Response(JSON.stringify(next), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (url.includes("api.resend.com")) {
    resendCalls.push({
      url,
      method,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify({ id: "mock" }), { status: 200 });
  }

  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

// --- app imports (after env + fetch patch) ----------------------------------------
const { POST: webhookPOST } = await import("../src/app/api/telegram/webhook/route");
const {
  getOwnerChatId,
  createPendingAction,
  takePendingAction,
  discardPendingAction,
} = await import("../src/lib/assistant/state");
const { getCatalog, saveCatalog } = await import("../src/lib/catalog");
const { executeTool, describeMutation, validateMutationArgs } = await import(
  "../src/lib/assistant/tools"
);
const { listOrders } = await import("../src/lib/orders");
const { listOutOfOffice, deleteOutOfOffice, listOwnerBookings } = await import(
  "../src/lib/admin/cal"
);
const { del, get, list, put } = await import("@vercel/blob");

// --- helpers ---------------------------------------------------------------------------
const OWNER_CHAT = 770_077_001;
const STRANGER_CHAT = 990_099_009;
const STRANGER2_CHAT = 880_088_008;
let updateId = 1;
let messageId = 100;

function tgRequest(update: unknown, secret = "test-webhook-secret"): Request {
  return new Request("https://book.victoriaholisticbeauty.com/api/telegram/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": secret,
    },
    body: JSON.stringify(update),
  });
}

async function sendText(chatId: number, text: string) {
  const res = await webhookPOST(
    tgRequest({
      update_id: updateId++,
      message: {
        message_id: messageId++,
        chat: { id: chatId, type: "private" },
        from: { id: chatId, first_name: "Test" },
        text,
      },
    }) as never
  );
  return res;
}

async function tapButton(chatId: number, data: string, fromId?: number) {
  return webhookPOST(
    tgRequest({
      update_id: updateId++,
      callback_query: {
        id: `cbq-${updateId}`,
        data,
        from: { id: fromId ?? chatId, first_name: "Test" },
        message: { message_id: 4242, chat: { id: chatId, type: "private" } },
      },
    }) as never
  );
}

function lastTelegramText(): string {
  for (let i = telegramCalls.length - 1; i >= 0; i--) {
    const b = telegramCalls[i].body as { text?: string } | undefined;
    if (b?.text) return b.text;
  }
  return "";
}

function lastKeyboardPendingId(): string | null {
  for (let i = telegramCalls.length - 1; i >= 0; i--) {
    const b = telegramCalls[i].body as
      | { reply_markup?: { inline_keyboard?: { callback_data: string }[][] } }
      | undefined;
    const btn = b?.reply_markup?.inline_keyboard?.[0]?.[0];
    if (btn) return btn.callback_data.replace(/^confirm:/, "");
  }
  return null;
}

/** sendMessage calls to a given chat whose text matches. */
function messagesTo(chatId: number, re: RegExp): Captured[] {
  return telegramCalls.filter((c) => {
    const b = c.body as { chat_id?: number; text?: string } | undefined;
    return (
      c.url.includes("sendMessage") &&
      b?.chat_id === chatId &&
      re.test(String(b?.text ?? ""))
    );
  });
}

const ALERT_RE = /tried to access Vassili/;
const REFUSAL_RE = /private assistant/;

async function readAuditEntries(): Promise<
  { at?: string; chatId?: number; kind?: string; detail?: Record<string, unknown> }[]
> {
  const r = await get("telegram/audit.jsonl", { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) return [];
  const text = await new Response(r.stream).text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as { chatId?: number; kind?: string };
      } catch {
        return {};
      }
    });
}

/**
 * Raw bytes of a blob, or null ONLY when the blob truly does not exist (the
 * SDK's 404 → null result). ANY other outcome — transport error, non-200
 * status — THROWS so the run aborts BEFORE mutating anything. Treating a
 * transient failure as "absent" at snapshot time would skip the real-owner
 * refusal gate below and make cleanup delete the production owner binding
 * (or restore catalog/products.json to "absent", deleting the live catalog).
 */
async function readBlobText(
  pathname: string,
  getImpl: typeof get = get
): Promise<string | null> {
  const r = await getImpl(pathname, { access: "private", useCache: false });
  if (r === null) return null; // SDK's true not-found — the blob is absent
  if (r.statusCode !== 200 || !r.stream) {
    throw new Error(
      `readBlobText(${pathname}): unexpected non-200 blob read (statusCode=${r.statusCode}) — refusing to treat as absent`
    );
  }
  return new Response(r.stream).text();
}

/** Restore a blob to its snapshotted bytes (null snapshot = delete). */
async function restoreBlobText(
  pathname: string,
  snapshot: string | null,
  contentType: string
): Promise<void> {
  if (snapshot === null) {
    try {
      await del(pathname);
    } catch {
      // already missing — fine
    }
    return;
  }
  await put(pathname, snapshot, {
    access: "private",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const RUN_STARTED_AT = new Date().toISOString();

// ====================================================================================
// Fail-closed self-test BEFORE the snapshot reads: a non-404 failure must
// THROW (aborting the run pre-mutation), never classify as "absent".
{
  let transportThrew = false;
  try {
    await readBlobText("telegram/owner.json", (async () => {
      throw new Error("simulated transient blob transport failure");
    }) as unknown as typeof get);
  } catch {
    transportThrew = true;
  }
  let non200Threw = false;
  try {
    await readBlobText("telegram/owner.json", (async () => ({
      statusCode: 304,
      stream: null,
    })) as unknown as typeof get);
  } catch {
    non200Threw = true;
  }
  check(
    "snapshot reads fail closed: non-404 blob failures throw, never read as 'absent'",
    transportThrew && non200Threw
  );
}

// ====================================================================================
// Snapshot production state FIRST — restored byte-identical in the finally
// cleanup at the bottom, even when the run crashes. These top-level awaits
// run BEFORE the mutating try block: any snapshot-read throw aborts the
// process with nothing touched.
// VASSILI_SIMULATE_SNAPSHOT_READ_FAILURE=1 injects a transient-500-style
// failure here so the abort-before-mutation behaviour can be verified from
// the outside (expected: non-zero exit, section 0 never runs).
const snapshotGet: typeof get =
  process.env.VASSILI_SIMULATE_SNAPSHOT_READ_FAILURE === "1"
    ? ((async () => {
        throw new Error(
          "simulated transient blob 500 (VASSILI_SIMULATE_SNAPSHOT_READ_FAILURE=1)"
        );
      }) as unknown as typeof get)
    : get;
console.log("=== snapshot: owner.json / audit.jsonl / products.json ===");
const ownerSnapshot = await readBlobText("telegram/owner.json", snapshotGet);
const auditSnapshot = await readBlobText("telegram/audit.jsonl", snapshotGet);
const productsSnapshot = await readBlobText("catalog/products.json", snapshotGet);
console.log(
  `owner=${ownerSnapshot === null ? "absent" : "present"}, audit=${
    auditSnapshot === null ? "absent" : `${auditSnapshot.length} bytes`
  }, products=${productsSnapshot === null ? "absent" : `${productsSnapshot.length} bytes`}`
);

// REFUSE to run against a real owner binding: section 0 unbinds the owner and
// the run re-binds the synthetic harness chat. A crash before cleanup would
// leave Victoria unbound (and binding reopened). Override only deliberately.
if (ownerSnapshot !== null && process.env.VASSILI_HARNESS_OVERRIDE !== "1") {
  let boundChatId: number | null = null;
  try {
    const parsed = JSON.parse(ownerSnapshot) as { chatId?: unknown };
    boundChatId = typeof parsed.chatId === "number" ? parsed.chatId : null;
  } catch {
    boundChatId = null; // unparseable — treat as unknown real state
  }
  if (boundChatId !== OWNER_CHAT) {
    console.error(
      `\nREFUSING TO RUN: telegram/owner.json holds a real owner binding (chatId=${boundChatId ?? "unparseable"}).\n` +
        "Running the harness would unbind the production owner. Set VASSILI_HARNESS_OVERRIDE=1 to override\n" +
        "(the snapshot/restore cleanup will put the record back, but only if the run reaches cleanup)."
    );
    process.exit(2);
  }
}

let crashed: unknown = null;
try {
  // ====================================================================================
  console.log("\n=== 0. Reset telegram/* state (idempotent harness) ===");
  for (const path of ["telegram/owner.json", "telegram/history.json", "telegram/alerts.json"]) {
    try {
      await del(path);
      console.log("deleted stale", path);
    } catch {
      // missing — fine
    }
  }

  console.log("\n=== 1. Gates: no token / bad secret / strangers ===");
  {
    const saved = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    const res = await sendText(OWNER_CHAT, "hi");
    check("501 when TELEGRAM_BOT_TOKEN unset", res.status === 501);
    process.env.TELEGRAM_BOT_TOKEN = saved;
  }
  {
    const res = await webhookPOST(
      tgRequest({ update_id: updateId++, message: { message_id: 1, chat: { id: 1 }, text: "x" } }, "WRONG") as never
    );
    check("401 on wrong webhook secret", res.status === 401);
  }
  {
    telegramCalls.length = 0;
    const res = await sendText(STRANGER_CHAT, "hello, can I book a massage?");
    check("stranger gets 200", res.status === 200);
    check(
      "stranger gets private-assistant refusal",
      lastTelegramText().includes("private assistant"),
      JSON.stringify(lastTelegramText()).slice(0, 120)
    );
  }
  {
    telegramCalls.length = 0;
    await sendText(OWNER_CHAT, "/start letmein-wrong");
    check("wrong /start pass → refusal", lastTelegramText().includes("private assistant"));
    const owner = await getOwnerChatId();
    check("owner NOT bound after wrong pass", owner !== OWNER_CHAT, `owner=${owner}`);
  }
  {
    // Empty ADMIN_PASS must fail closed — no empty-string bypass, ever.
    const savedPass = process.env.ADMIN_PASS;
    process.env.ADMIN_PASS = "";
    telegramCalls.length = 0;
    await sendText(OWNER_CHAT, "/start"); // empty supplied pass vs empty ADMIN_PASS
    await sendText(OWNER_CHAT, "/start anything");
    check("empty ADMIN_PASS → binding impossible", (await getOwnerChatId()) === null);
    check(
      "empty ADMIN_PASS → refusal (not greeting)",
      messagesTo(OWNER_CHAT, REFUSAL_RE).length === 2 &&
        messagesTo(OWNER_CHAT, /ops assistant/).length === 0
    );
    process.env.ADMIN_PASS = savedPass;
  }

  console.log("\n=== 2. Owner binding ===");
  {
    telegramCalls.length = 0;
    await sendText(OWNER_CHAT, `/start ${ADMIN_PASS}`);
    check("greeting after correct pass", lastTelegramText().includes("ops assistant"));
    const owner = await getOwnerChatId();
    check("Blob owner.json bound to chat", owner === OWNER_CHAT, `owner=${owner}`);
  }

  console.log("\n=== 2b. Hardening: one-time binding, intrusion alerts, audit ===");
  {
    // (a) stranger /start with a WRONG password after binding → refusal + alert
    telegramCalls.length = 0;
    await sendText(STRANGER_CHAT, "/start hunter2");
    check(
      "stranger wrong-pass /start → generic refusal",
      messagesTo(STRANGER_CHAT, REFUSAL_RE).length === 1
    );
    check(
      "owner alerted about wrong-pass attempt",
      messagesTo(OWNER_CHAT, ALERT_RE).length === 1,
      JSON.stringify(messagesTo(OWNER_CHAT, ALERT_RE)[0]?.body).slice(0, 160)
    );

    // (b) stranger /start with the CORRECT password after binding → NO rebind
    telegramCalls.length = 0;
    await sendText(STRANGER_CHAT, `/start ${ADMIN_PASS}`);
    check(
      "correct-pass /start from stranger → generic refusal (no greeting leak)",
      messagesTo(STRANGER_CHAT, REFUSAL_RE).length === 1 &&
        messagesTo(STRANGER_CHAT, /ops assistant|already connected/i).length === 0
    );
    check(
      "binding NOT hijacked — owner unchanged",
      (await getOwnerChatId()) === OWNER_CHAT
    );
    check(
      "owner alerted about correct-pass rebind attempt",
      messagesTo(OWNER_CHAT, ALERT_RE).length === 1 &&
        /CORRECT password/.test(
          String((messagesTo(OWNER_CHAT, ALERT_RE)[0]?.body as { text?: string })?.text)
        )
    );

    // owner /start again → friendly idempotent reply, no alert, no rebind error
    telegramCalls.length = 0;
    await sendText(OWNER_CHAT, `/start ${ADMIN_PASS}`);
    check(
      "owner /start again → friendly already-connected reply",
      /already connected/i.test(lastTelegramText()),
      lastTelegramText().slice(0, 100)
    );
    check(
      "owner /start does not trigger an alert",
      messagesTo(OWNER_CHAT, ALERT_RE).length === 0
    );

    // (c) stranger plain message → refusal + first-contact alert (3rd alert in window)
    telegramCalls.length = 0;
    await sendText(STRANGER_CHAT, "hey, what's Victoria's schedule?");
    check(
      "stranger plain message → refusal",
      messagesTo(STRANGER_CHAT, REFUSAL_RE).length === 1
    );
    check(
      "first-contact alert for stranger message",
      messagesTo(OWNER_CHAT, ALERT_RE).length === 1
    );

    // rate cap: 4th alert-eligible attempt within the hour → NO alert
    telegramCalls.length = 0;
    await sendText(STRANGER_CHAT, "/start another-guess");
    check(
      "4th attempt still refused",
      messagesTo(STRANGER_CHAT, REFUSAL_RE).length === 1
    );
    check(
      "alert rate-limit: 4th attempt within the hour → NO alert",
      messagesTo(OWNER_CHAT, ALERT_RE).length === 0
    );

    // day-gating for plain messages (fresh stranger, cap untouched)
    telegramCalls.length = 0;
    await sendText(STRANGER2_CHAT, "hello?");
    check(
      "second stranger first message → alert",
      messagesTo(OWNER_CHAT, ALERT_RE).length === 1
    );
    telegramCalls.length = 0;
    await sendText(STRANGER2_CHAT, "are you ignoring me?");
    check(
      "second stranger repeat message same day → NO alert (day gate)",
      messagesTo(OWNER_CHAT, ALERT_RE).length === 0
    );
    check(
      "…but still refused",
      messagesTo(STRANGER2_CHAT, REFUSAL_RE).length === 1
    );

    // stranger callback tap → privately refused, nothing executes
    telegramCalls.length = 0;
    calMutations.length = 0;
    await tapButton(STRANGER2_CHAT, "confirm:00000000-0000-4000-8000-000000000000");
    const cbAnswer = telegramCalls.find((c) => c.url.includes("answerCallbackQuery"));
    check(
      "stranger callback tap → answered 'private', no mutation",
      Boolean(cbAnswer) && calMutations.length === 0
    );

    // audit completeness — only entries written by THIS run count
    const audit = await readAuditEntries();
    const has = (kind: string, chatId: number) =>
      audit.some(
        (e) =>
          e.kind === kind &&
          e.chatId === chatId &&
          typeof e.at === "string" &&
          e.at >= RUN_STARTED_AT
      );
    check("audit: start-wrong-pass logged", has("start-wrong-pass", STRANGER_CHAT));
    check(
      "audit: start-rebind-blocked logged",
      has("start-rebind-blocked", STRANGER_CHAT)
    );
    check(
      "audit: unauthorized-message logged",
      has("unauthorized-message", STRANGER_CHAT)
    );
    check(
      "audit: unauthorized-callback logged",
      has("unauthorized-callback", STRANGER2_CHAT)
    );
  }

  console.log("\n=== 2c. Owner tapping a stale/inaccessible-message button ===");
  {
    // Telegram omits callback_query.message for messages older than ~48h or
    // otherwise inaccessible. The OWNER pressing such a button is not an
    // intruder: expect a quiet "expired" answer, no alert, no intruder audit.
    telegramCalls.length = 0;
    await webhookPOST(
      tgRequest({
        update_id: updateId++,
        callback_query: {
          id: "cbq-stale-owner",
          data: "confirm:00000000-0000-4000-8000-000000000000",
          from: { id: OWNER_CHAT, first_name: "Test" },
          // no `message` field — stale/inaccessible
        },
      }) as never
    );
    const staleAnswer = telegramCalls.find((c) => c.url.includes("answerCallbackQuery"));
    check(
      "owner stale-button tap → 'expired' callback answer",
      Boolean(
        staleAnswer &&
          /expired/i.test(String((staleAnswer.body as { text?: string })?.text))
      ),
      JSON.stringify(staleAnswer?.body).slice(0, 160)
    );
    check(
      "owner stale-button tap → NO intruder alert about herself",
      messagesTo(OWNER_CHAT, ALERT_RE).length === 0
    );
    const audit = await readAuditEntries();
    check(
      "owner stale-button tap → no unauthorized-callback audit entry",
      !audit.some(
        (e) =>
          e.kind === "unauthorized-callback" &&
          e.chatId === OWNER_CHAT &&
          typeof e.at === "string" &&
          e.at >= RUN_STARTED_AT
      )
    );
  }

  console.log("\n=== 3. \"what's my day?\" (real brief data via real Ollama+Cal+Blob) ===");
  {
    telegramCalls.length = 0;
    await sendText(OWNER_CHAT, "what's my day looking like?");
    const reply = lastTelegramText();
    console.log("--- reply ---\n" + reply + "\n-------------");
    check("got a non-empty reply", reply.length > 20);
    check(
      "reply reflects real data (mentions booking/order/pending substance)",
      /pending|booking|appointment|order|quiet|calm/i.test(reply)
    );
  }

  // Sections 4–5 act on whatever booking is PENDING on Cal right now (the
  // harness never hardcodes uids — live data changes between runs).
  const pendingNow = (await listOwnerBookings()).filter(
    (b) => (b.status || "").toLowerCase() === "pending"
  );
  const flowTarget = pendingNow[0];
  const flowClient = flowTarget?.attendees?.[0]?.name ?? "";
  const flowService = (flowTarget?.title || "Booking").split(" between ")[0];

  console.log(
    `\n=== 4. Confirm-booking flow (live pending: ${flowClient || "NONE"}) — Cal mutation stubbed ===`
  );
  if (!flowTarget) {
    check("confirm flow (skipped — no pending bookings on Cal right now)", true);
  } else {
    telegramCalls.length = 0;
    calMutations.length = 0;
    await sendText(
      OWNER_CHAT,
      `please confirm ${flowClient}'s pending "${flowService}" booking request`
    );
    const confirmMsg = lastTelegramText();
    const pendingId = lastKeyboardPendingId();
    console.log("--- confirm prompt ---\n" + confirmMsg + "\npendingId: " + pendingId);
    check("agent asked for confirmation with keyboard", pendingId !== null);
    check(
      `summary references the real uid (${flowTarget.uid})`,
      confirmMsg.includes(flowTarget.uid),
      confirmMsg.slice(0, 160)
    );
    check(
      "confirm summary disclosure: client gets a confirmation email",
      /client will receive a booking-confirmation email/i.test(confirmMsg),
      confirmMsg.slice(0, 220)
    );
    check("no Cal mutation before Confirm tap", calMutations.length === 0);

    if (pendingId) {
      telegramCalls.length = 0;
      await tapButton(OWNER_CHAT, `confirm:${pendingId}`);
      check(
        "Confirm tap → confirmBooking called with the right uid",
        calMutations.some((c) => c.url.includes(`/bookings/${flowTarget.uid}/confirm`)),
        calMutations.map((c) => c.url).join(", ")
      );
      const edited = telegramCalls.find((c) => c.url.includes("editMessageText"));
      check(
        "result edited into the message",
        Boolean(edited && String((edited.body as { text?: string })?.text).includes("done")),
        String((edited?.body as { text?: string })?.text).slice(0, 120)
      );
      // double-tap: must be gone
      calMutations.length = 0;
      await tapButton(OWNER_CHAT, `confirm:${pendingId}`);
      check("second Confirm tap is a no-op", calMutations.length === 0);
    }
  }

  console.log("\n=== 5. Cancel path ===");
  if (!flowTarget) {
    check("cancel path (skipped — no pending bookings on Cal right now)", true);
  } else {
    telegramCalls.length = 0;
    calMutations.length = 0;
    await sendText(
      OWNER_CHAT,
      `decline ${flowClient}'s "${flowService}" booking request, reason: schedule conflict`
    );
    const pendingId = lastKeyboardPendingId();
    check("decline parked behind keyboard", pendingId !== null, lastTelegramText().slice(0, 140));
    check(
      "decline summary disclosure: reason is emailed to the client",
      /EMAILED this reason/.test(lastTelegramText()),
      lastTelegramText().slice(0, 220)
    );
    if (pendingId) {
      telegramCalls.length = 0;
      await tapButton(OWNER_CHAT, `cancel:${pendingId}`);
      check("Cancel tap → no Cal mutation", calMutations.length === 0);
      const edited = telegramCalls.find((c) => c.url.includes("editMessageText"));
      check(
        "message edited to Cancelled",
        Boolean(edited && /cancelled/i.test(String((edited.body as { text?: string })?.text)))
      );
    }
  }

  console.log("\n=== 6. Catalog mutation (REAL blob): tohar → 15 → byte-identical restore ===");
  {
    // Raw bytes BEFORE the mutation — restored EXACTLY afterwards. A logical
    // restore (read-modify-write) would stamp a fresh updatedAt and leave the
    // blob different from production state.
    const section6Bytes = await readBlobText("catalog/products.json");
    check("catalog blob exists for byte-identical restore", section6Bytes !== null);

    const before = await getCatalog();
    const tohar = before.find((p) => p.slug === "tohar-hamidbar-concentrate");
    console.log("tohar quantity before:", tohar?.quantity);
    telegramCalls.length = 0;
    await sendText(OWNER_CHAT, "set tohar quantity to 15");
    const pendingId = lastKeyboardPendingId();
    const prompt = lastTelegramText();
    check("product_update parked behind keyboard", pendingId !== null, prompt.slice(0, 140));
    check("summary mentions quantity 15", /quantity 15/.test(prompt), prompt.slice(0, 140));

    const midway = await getCatalog();
    check(
      "catalog unchanged before Confirm",
      midway.find((p) => p.slug === "tohar-hamidbar-concentrate")?.quantity === tohar?.quantity
    );

    if (pendingId) {
      await tapButton(OWNER_CHAT, `confirm:${pendingId}`);
      const after = await getCatalog();
      const q = after.find((p) => p.slug === "tohar-hamidbar-concentrate")?.quantity;
      check("REAL catalog updated to 15", q === 15, `quantity=${q}`);
      // restore the EXACT pre-mutation bytes
      if (section6Bytes !== null) {
        await restoreBlobText("catalog/products.json", section6Bytes, "application/json");
      }
      const restored = await readBlobText("catalog/products.json");
      check(
        "catalog blob byte-identical after section 6 restore",
        section6Bytes !== null && restored === section6Bytes,
        `len ${section6Bytes?.length} → ${restored?.length}`
      );
    }
  }

  console.log("\n=== 7. PDF document on letterhead ===");
  {
    telegramCalls.length = 0;
    lastPdf = null;
    await sendText(
      OWNER_CHAT,
      "make me an offer document for Palm Hills — three sentences offering our facial treatments for their spa guests"
    );
    const docCall = telegramCalls.find((c) => c.url.includes("sendDocument"));
    check("sendDocument multipart captured", Boolean(docCall), JSON.stringify(docCall?.form));
    // TS can't see the fetch-closure reassignment — widen explicitly.
    const pdfBuf = lastPdf as Buffer | null;
    check(
      "PDF buffer present and looks like a PDF",
      Boolean(pdfBuf && pdfBuf.subarray(0, 5).toString().startsWith("%PDF")),
      `size=${pdfBuf?.length}`
    );
    if (pdfBuf) {
      const out = "/tmp/vassili-offer-sample.pdf";
      writeFileSync(out, pdfBuf);
      console.log("PDF saved for inspection:", out);
    }
    console.log("final agent text:", lastTelegramText().slice(0, 200));
  }

  console.log("\n=== 8. Daily-brief cron pushes to Telegram ===");
  {
    telegramCalls.length = 0;
    const { GET: cronGET } = await import("../src/app/api/cron/daily-brief/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(
      "https://book.victoriaholisticbeauty.com/api/cron/daily-brief?force=1",
      { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }
    );
    const res = await cronGET(req);
    const json = (await res.json()) as { telegram?: { sent: boolean }; email?: unknown };
    console.log("cron response:", JSON.stringify(json).slice(0, 300));
    check("cron ok", res.status === 200);
    check("telegram push sent to bound owner", json.telegram?.sent === true);
    const pushed = telegramCalls.find(
      (c) => c.url.includes("sendMessage") && (c.body as { chat_id?: number })?.chat_id === OWNER_CHAT
    );
    check(
      "brief text pushed to owner chat",
      Boolean(pushed && /Good morning/.test(String((pushed.body as { text?: string })?.text)))
    );
  }

  console.log("\n=== 9. Read-only tools: stats_summary / client_history / order_lookup ===");
  {
    const ctx = { chatId: OWNER_CHAT };

    const stats = await executeTool("stats_summary", { period: "month" }, ctx);
    console.log("--- stats_summary(month) ---\n" + stats);
    check(
      "stats_summary returns real aggregates",
      /Stats for this month/.test(stats) &&
        /Bookings — \d+ confirmed/.test(stats) &&
        /Orders — \d+ total, \d+ EGP revenue/.test(stats)
    );

    const hist = await executeTool("client_history", { query: "hany" }, ctx);
    console.log("--- client_history(hany) ---\n" + hist.slice(0, 500));
    check(
      "client_history matches by name substring",
      /hany/i.test(hist) && /booking\(s\)/.test(hist)
    );

    const someOrder = (await listOrders({ limit: 1 }))[0];
    if (someOrder) {
      const lookup = await executeTool(
        "order_lookup",
        { orderNumber: someOrder.orderNumber },
        ctx
      );
      console.log("--- order_lookup ---\n" + lookup);
      check(
        "order_lookup gives full detail (items, totals, address, history)",
        lookup.includes(someOrder.orderNumber) &&
          /Items:/.test(lookup) &&
          /Address:/.test(lookup) &&
          /Total: \d+ EGP/.test(lookup) &&
          /Status history:/.test(lookup)
      );
    } else {
      check("order_lookup full detail (skipped — no orders in store)", true);
    }

    // Via the agent these are read-only: instant answer, NO confirm keyboard.
    telegramCalls.length = 0;
    await sendText(OWNER_CHAT, "how is this month going? give me the stats summary");
    check(
      "stats via agent → instant reply, no keyboard",
      lastKeyboardPendingId() === null && lastTelegramText().length > 10,
      lastTelegramText().slice(0, 140)
    );
  }

  console.log("\n=== 10. product_add → live → product_remove → byte-identical restore ===");
  {
    // Raw catalog bytes BEFORE — the test must leave the blob byte-identical.
    const beforeText = await readBlobText("catalog/products.json");
    check("catalog blob exists for byte-identical comparison", beforeText !== null);

    telegramCalls.length = 0;
    await sendText(
      OWNER_CHAT,
      'add a new product to the shop: English name "Test Harness Balm", Russian name "Тестовый бальзам", price 999 EGP, quantity 3'
    );
    const addId = lastKeyboardPendingId();
    const addPrompt = lastTelegramText();
    console.log("--- add prompt ---\n" + addPrompt);
    check("product_add parked behind keyboard", addId !== null, addPrompt.slice(0, 200));
    check(
      "add summary disclosure: product goes LIVE on the site",
      /LIVE on the public site/i.test(addPrompt),
      addPrompt.slice(0, 220)
    );
    check(
      "catalog unchanged before Confirm",
      !(await getCatalog()).some(
        (p) => p.en.name === "Test Harness Balm" || p.slug.startsWith("test-harness")
      )
    );

    let slug = "";
    if (addId) {
      telegramCalls.length = 0;
      await tapButton(OWNER_CHAT, `confirm:${addId}`);
      const after = await getCatalog();
      const added = after.find(
        (p) => p.en.name === "Test Harness Balm" || p.slug.startsWith("test-harness")
      );
      slug = added?.slug ?? "";
      check(
        "REAL catalog gained the product (active, 999 EGP, qty 3)",
        Boolean(
          added &&
            added.active &&
            added.priceEgp === 999 &&
            added.quantity === 3 &&
            !added.soldOut
        ),
        JSON.stringify(added).slice(0, 200)
      );
    }

    if (slug) {
      telegramCalls.length = 0;
      await sendText(OWNER_CHAT, `now remove the product ${slug} from the shop`);
      const rmId = lastKeyboardPendingId();
      const rmPrompt = lastTelegramText();
      console.log("--- remove prompt ---\n" + rmPrompt);
      check("product_remove parked behind keyboard", rmId !== null, rmPrompt.slice(0, 160));
      check(
        "remove summary disclosure: hidden from site, reversible",
        /disappears from the public site/i.test(rmPrompt) && /reversible/i.test(rmPrompt),
        rmPrompt.slice(0, 220)
      );
      if (rmId) {
        await tapButton(OWNER_CHAT, `confirm:${rmId}`);
        const after = await getCatalog();
        const p = after.find((x) => x.slug === slug);
        check(
          "soft-removed: active=false but still in catalog",
          Boolean(p && p.active === false),
          JSON.stringify(p).slice(0, 160)
        );
      }
      // Hard cleanup: drop the test product entirely.
      const cleaned = (await getCatalog()).filter((p) => p.slug !== slug);
      await saveCatalog(cleaned);
    }

    const afterText = await readBlobText("catalog/products.json");
    check(
      "catalog byte-identical after hard cleanup",
      beforeText !== null && afterText === beforeText,
      `len ${beforeText?.length} → ${afterText?.length}`
    );
  }

  console.log("\n=== 11. block_time: REAL far-future Cal OOO create + cleanup ===");
  {
    telegramCalls.length = 0;
    await sendText(
      OWNER_CHAT,
      "block my calendar for 5 March 2027 (the whole day), note: harness test"
    );
    const blockId = lastKeyboardPendingId();
    const blockPrompt = lastTelegramText();
    console.log("--- block prompt ---\n" + blockPrompt);
    check("block_time parked behind keyboard", blockId !== null, blockPrompt.slice(0, 200));
    check(
      "block summary disclosure: WHOLE days become unbookable",
      /WHOLE day/i.test(blockPrompt) && /unbookable/i.test(blockPrompt),
      blockPrompt.slice(0, 220)
    );
    if (blockId) {
      telegramCalls.length = 0;
      await tapButton(OWNER_CHAT, `confirm:${blockId}`);
      const edited = telegramCalls.find((c) => c.url.includes("editMessageText"));
      console.log(
        "block result:",
        String((edited?.body as { text?: string })?.text).slice(0, 220)
      );
      const entries = await listOutOfOffice();
      const mine = entries.filter((e) => (e.start || "").startsWith("2027-03-05"));
      check(
        "REAL Cal OOO entry created for 2027-03-05",
        mine.length === 1,
        JSON.stringify(entries).slice(0, 300)
      );
      for (const e of mine) await deleteOutOfOffice(e.id);
      const left = (await listOutOfOffice()).filter((e) =>
        (e.start || "").startsWith("2027-03-05")
      );
      check("OOO entry cleaned up (calendar unblocked)", left.length === 0);
    }
  }

  console.log("\n=== 12. Russian PDF via agent (embedded Cyrillic fonts) ===");
  {
    telegramCalls.length = 0;
    lastPdf = null;
    await sendText(
      OWNER_CHAT,
      "сделай PDF-документ: коммерческое предложение для спа-отеля, два-три предложения на русском"
    );
    const ruPdf = lastPdf as Buffer | null;
    check(
      "RU PDF generated",
      Boolean(ruPdf && ruPdf.subarray(0, 5).toString().startsWith("%PDF")),
      `size=${ruPdf?.length}`
    );
    check(
      "embedded PT fonts present in the PDF (no built-in Latin-only fonts)",
      Boolean(
        ruPdf &&
          (ruPdf.includes("PTSerif-Regular") || ruPdf.includes("PTSans-Regular")) &&
          !ruPdf.includes("/BaseFont /Helvetica")
      )
    );
    if (ruPdf) {
      writeFileSync("/tmp/vassili-ru-agent-sample.pdf", ruPdf);
      console.log("RU PDF saved for visual inspection: /tmp/vassili-ru-agent-sample.pdf");
    }
    console.log("final agent text:", lastTelegramText().slice(0, 200));
  }

  console.log("\n=== 13. Disclosure: order status email & outsider email preview ===");
  {
    // Structural guarantees first — disclosure lives in describeMutation, so
    // these hold no matter what live data exists.
    check(
      "describeMutation(order_set_status→shipped) discloses the status email",
      /client will receive a status email/i.test(
        describeMutation("order_set_status", { orderNumber: "VV-TEST00", status: "shipped" })
      )
    );
    check(
      "describeMutation(order_set_status→cancelled) discloses reason email",
      /cancellation email INCLUDING this reason/i.test(
        describeMutation("order_set_status", {
          orderNumber: "VV-TEST00",
          status: "cancelled",
          reason: "out of stock",
        })
      )
    );
    check(
      "describeMutation(booking_decline) discloses reason email",
      /EMAILED this reason/.test(
        describeMutation("booking_decline", { uid: "x", reason: "y" })
      )
    );
    check(
      "describeMutation(email_send) shows recipient + subject + full body",
      (() => {
        const d = describeMutation("email_send", {
          to: "a@b.com",
          subject: "S",
          body: "full body text here",
        });
        return (
          d.includes("a@b.com") &&
          d.includes('Subject: "S"') &&
          d.includes("full body text here")
        );
      })()
    );

    // order_set_status: park → assert disclosure → CANCEL (no real change).
    const mutable = (await listOrders({ limit: 30 })).find(
      (o) => o.status === "ordered" || o.status === "confirmed"
    );
    if (mutable) {
      const next = mutable.status === "ordered" ? "confirmed" : "shipped";
      telegramCalls.length = 0;
      await sendText(OWNER_CHAT, `set order ${mutable.orderNumber} to ${next}`);
      const id = lastKeyboardPendingId();
      const prompt = lastTelegramText();
      console.log("--- status prompt ---\n" + prompt);
      check("order_set_status parked behind keyboard", id !== null, prompt.slice(0, 160));
      check(
        "status summary disclosure: client receives a status email",
        /client will receive a (status|cancellation) email/i.test(prompt),
        prompt.slice(0, 220)
      );
      if (id) await tapButton(OWNER_CHAT, `cancel:${id}`);
      const fresh = (await listOrders({ limit: 30 })).find(
        (o) => o.orderNumber === mutable.orderNumber
      );
      check(
        "order untouched after Cancel",
        fresh?.status === mutable.status,
        `status=${fresh?.status}`
      );
    } else {
      check("order_set_status disclosure (skipped — no mutable order)", true);
    }

    // email_send to an outsider: summary must show recipient + subject + FULL body.
    telegramCalls.length = 0;
    resendCalls.length = 0;
    await sendText(
      OWNER_CHAT,
      'send an email to partner@example.com with subject "Samples" and exactly this body: "Hello! The Onmacabim samples ship on Monday. Warm regards, Victoria"'
    );
    const mailId = lastKeyboardPendingId();
    const mailPrompt = lastTelegramText();
    console.log("--- email prompt ---\n" + mailPrompt);
    check("outsider email parked behind keyboard", mailId !== null);
    check(
      "email summary shows recipient + subject + full body preview",
      mailPrompt.includes("partner@example.com") &&
        /Subject:/.test(mailPrompt) &&
        /full message/.test(mailPrompt) &&
        /samples/i.test(mailPrompt),
      mailPrompt.slice(0, 300)
    );
    check("no email sent before confirm", resendCalls.length === 0);
    if (mailId) await tapButton(OWNER_CHAT, `cancel:${mailId}`);
  }

  console.log("\n=== 14. Pending-action concurrency: exactly-once claims ===");
  {
    // Two PARALLEL Confirm taps on one pending action: exactly one may
    // execute. del() succeeds silently on already-deleted blobs, so this is
    // only safe with the atomic claim (allowOverwrite: false) underneath.
    const a = await createPendingAction({
      chatId: OWNER_CHAT,
      tool: "email_send",
      args: { to: "x@example.com", subject: "s", body: "b" },
      summary: "concurrency test A",
    });
    const [r1, r2] = await Promise.all([
      takePendingAction(a.id),
      takePendingAction(a.id),
    ]);
    check(
      "Confirm+Confirm in parallel → exactly one wins",
      (r1.ok ? 1 : 0) + (r2.ok ? 1 : 0) === 1,
      JSON.stringify({ r1, r2 }).slice(0, 200)
    );

    // Confirm racing Cancel: exactly one may claim the action.
    const b = await createPendingAction({
      chatId: OWNER_CHAT,
      tool: "email_send",
      args: { to: "x@example.com", subject: "s", body: "b" },
      summary: "concurrency test B",
    });
    const [take, discarded] = await Promise.all([
      takePendingAction(b.id),
      discardPendingAction(b.id),
    ]);
    check(
      "Confirm+Cancel in parallel → exactly one wins",
      (take.ok ? 1 : 0) + (discarded ? 1 : 0) === 1,
      JSON.stringify({ take, discarded }).slice(0, 200)
    );

    // Sequential second tap after a win still finds nothing.
    const r3 = await takePendingAction(a.id);
    check("third (late) Confirm tap → not-found", !r3.ok);

    // Stale Cancel honesty: once the pending blob is gone (executed,
    // cancelled, or swept after expiry), discard must return false — the
    // route then says "no longer available", never the lie
    // "Cancelled — nothing was changed".
    const staleCancel = await discardPendingAction(b.id);
    check("stale Cancel on already-handled pending → false", staleCancel === false);
    const ghostCancel = await discardPendingAction(crypto.randomUUID());
    check("Cancel on a never-existing pending id → false", ghostCancel === false);
  }

  console.log("\n=== 15. Mutation-arg validation (summary/executor parity) ===");
  {
    const arrayTo = validateMutationArgs("email_send", {
      to: ["attacker@evil.com"],
      subject: "Hi",
      body: "B",
    });
    check("array-typed `to` → REFUSED (never parked)", arrayTo.ok === false);

    const badEmail = validateMutationArgs("email_send", {
      to: "not-an-email",
      subject: "s",
      body: "b",
    });
    check("non-email `to` → REFUSED", badEmail.ok === false);

    const good = validateMutationArgs("email_send", {
      to: " a@b.com ",
      subject: "s",
      body: "b",
      undeclaredExtra: "dropped",
    });
    check(
      "valid email_send passes, trimmed + undeclared params dropped",
      good.ok === true &&
        good.args.to === "a@b.com" &&
        !("undeclaredExtra" in good.args)
    );

    const objSlug = validateMutationArgs("product_update", {
      slug: { $gt: "" },
      quantity: 5,
    });
    check("non-string slug on product_update → REFUSED", objSlug.ok === false);

    // Numbers-as-strings: lossless ones coerce (and the summary renders the
    // coerced value — confirm-what-executes preserved); lossy/non-numeric
    // strings are still refused.
    const strQty = validateMutationArgs("product_update", {
      slug: "tohar-hamidbar-concentrate",
      quantity: "15",
    });
    check(
      "lossless numeric string quantity '15' → coerced to number 15",
      strQty.ok === true && strQty.args.quantity === 15
    );
    const strPrice = validateMutationArgs("product_update", {
      slug: "tohar-hamidbar-concentrate",
      priceEgp: "250",
    });
    check(
      "string priceEgp '250' → coerced; summary renders 250 EGP",
      strPrice.ok === true &&
        strPrice.args.priceEgp === 250 &&
        /price 250 EGP/.test(describeMutation("product_update", strPrice.args))
    );
    const lossyQty = validateMutationArgs("product_update", {
      slug: "tohar-hamidbar-concentrate",
      quantity: "015",
    });
    check("lossy numeric string '015' → still REFUSED", lossyQty.ok === false);
    const nonNumQty = validateMutationArgs("product_update", {
      slug: "tohar-hamidbar-concentrate",
      quantity: "lots",
    });
    check("non-numeric string quantity → REFUSED", nonNumQty.ok === false);

    const missingReason = validateMutationArgs("booking_decline", { uid: "u1" });
    check("missing required reason on booking_decline → REFUSED", missingReason.ok === false);

    const badStatus = validateMutationArgs("order_set_status", {
      orderNumber: "VV-AB12CD",
      status: "exploded",
    });
    check("enum violation on order_set_status → REFUSED", badStatus.ok === false);
  }

  console.log(
    "\n=== 15b. Agent loop (scripted model): string price parks coerced; invalid arg → retry round ==="
  );
  {
    // (a) Model emits '"priceEgp": "250"' (numbers-as-strings) — must be
    // coerced, parked behind the keyboard, and the summary must show 250.
    telegramCalls.length = 0;
    ollamaRequests.length = 0;
    scriptedOllama = [
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              function: {
                name: "product_update",
                arguments: { slug: "tohar-hamidbar-concentrate", priceEgp: "250" },
              },
            },
          ],
        },
      },
    ];
    await sendText(OWNER_CHAT, "set tohar price to 250 EGP");
    const coercedId = lastKeyboardPendingId();
    const coercedPrompt = lastTelegramText();
    check(
      "model's string '250' price → coerced, parked, summary shows 250 EGP",
      coercedId !== null && /price 250 EGP/.test(coercedPrompt),
      coercedPrompt.slice(0, 160)
    );
    if (coercedId) await tapButton(OWNER_CHAT, `cancel:${coercedId}`);

    // (b) Genuinely invalid arg: REFUSED goes back to the model as a tool
    // result and it gets a retry round — Victoria sees the model's
    // self-correction, not an immediate refusal ending the loop.
    telegramCalls.length = 0;
    ollamaRequests.length = 0;
    scriptedOllama = [
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              function: {
                name: "product_update",
                arguments: { slug: "tohar-hamidbar-concentrate", quantity: "lots" },
              },
            },
          ],
        },
      },
      {
        message: {
          role: "assistant",
          content: "Quantity needs to be a number — how many units should I set?",
        },
      },
    ];
    await sendText(OWNER_CHAT, "set tohar quantity to lots");
    const retryReply = lastTelegramText();
    check(
      "invalid arg → REFUSED fed back to the model as a tool result (retry round granted)",
      ollamaRequests.length === 2 &&
        ollamaRequests[1].messages.some(
          (m) => m.role === "tool" && /REFUSED/.test(m.content)
        ),
      `ollama calls=${ollamaRequests.length}`
    );
    check(
      "user sees the model's self-correction, not an immediate refusal",
      /how many units/i.test(retryReply) &&
        !/I can't do that as asked/.test(retryReply),
      retryReply.slice(0, 160)
    );
    check(
      "nothing parked for the invalid call",
      lastKeyboardPendingId() === null
    );
    scriptedOllama = null;
  }

  console.log("\n=== 16. Telegram update_id dedupe (redelivery protection) ===");
  {
    telegramCalls.length = 0;
    const dupUpdate = {
      update_id: 987_654_321,
      message: {
        message_id: messageId++,
        chat: { id: STRANGER2_CHAT, type: "private" },
        from: { id: STRANGER2_CHAT, first_name: "Dup" },
        text: "duplicate delivery test",
      },
    };
    const first = await webhookPOST(tgRequest(dupUpdate) as never);
    const refusalsAfterFirst = messagesTo(STRANGER2_CHAT, REFUSAL_RE).length;
    const second = await webhookPOST(tgRequest(dupUpdate) as never);
    const secondJson = (await second.json()) as { deduped?: boolean };
    check(
      "first delivery handled normally",
      first.status === 200 && refusalsAfterFirst === 1
    );
    check(
      "redelivered update_id skipped (no second reply)",
      second.status === 200 &&
        secondJson.deduped === true &&
        messagesTo(STRANGER2_CHAT, REFUSAL_RE).length === 1,
      JSON.stringify(secondJson)
    );
  }
} catch (error) {
  crashed = error;
} finally {
  // ====================================================================================
  console.log("\n=== cleanup: restore production Blob state (always runs) ===");

  // Working state created by the run — delete.
  for (const path of ["telegram/history.json", "telegram/alerts.json"]) {
    try {
      await del(path);
      console.log("deleted", path);
    } catch {
      // missing — fine
    }
  }

  // Pending actions + exactly-once claim markers created by the run — sweep.
  try {
    for (const prefix of ["telegram/pending/", "telegram/claims/"]) {
      const { blobs } = await list({ prefix });
      for (const blob of blobs) {
        try {
          await del(blob.pathname);
        } catch {
          // best effort
        }
      }
      console.log(`swept ${blobs.length} blob(s) under ${prefix}`);
    }
  } catch (error) {
    console.log("pending/claims sweep failed:", error instanceof Error ? error.message : error);
  }

  // Owner binding + audit log: restore the EXACT pre-run bytes (or absence).
  try {
    await restoreBlobText("telegram/owner.json", ownerSnapshot, "application/json");
    check(
      "owner.json restored byte-identical to pre-run state",
      (await readBlobText("telegram/owner.json")) === ownerSnapshot
    );
  } catch (error) {
    check("owner.json restored byte-identical to pre-run state", false, String(error));
  }
  try {
    await restoreBlobText("telegram/audit.jsonl", auditSnapshot, "application/x-ndjson");
    check(
      "audit.jsonl restored byte-identical to pre-run state",
      (await readBlobText("telegram/audit.jsonl")) === auditSnapshot
    );
  } catch (error) {
    check("audit.jsonl restored byte-identical to pre-run state", false, String(error));
  }

  // Shop catalog: must end the run byte-identical. Sections 6 and 10 restore
  // themselves; this is the crash-safe backstop + the whole-run guarantee.
  try {
    const productsNow = await readBlobText("catalog/products.json");
    if (productsNow !== productsSnapshot) {
      console.log("products.json drifted — restoring run-start bytes");
      await restoreBlobText("catalog/products.json", productsSnapshot, "application/json");
    }
    check(
      "products.json byte-identical across the whole run",
      (await readBlobText("catalog/products.json")) === productsSnapshot,
      `snapshot ${productsSnapshot?.length ?? "absent"} bytes`
    );
  } catch (error) {
    check("products.json byte-identical across the whole run", false, String(error));
  }
}

if (crashed) {
  console.error("\nHARNESS CRASHED MID-RUN (state was still restored):", crashed);
  failures++;
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
