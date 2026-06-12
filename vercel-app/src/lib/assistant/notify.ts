import {
  sendMessage,
  telegramConfigured,
  type InlineKeyboard,
} from "../telegram";
import {
  createPendingAction,
  getOwnerChatId,
  NOTIFY_PENDING_TTL_MS,
} from "./state";
import { describeMutation, validateMutationArgs } from "./tools";
import { formatCairoTime, type BookingDetails } from "../booking-emails";
import type { StoredOrder } from "../orders";

/**
 * Proactive Telegram pushes to Victoria (the bound owner chat): new booking
 * requests, new shop orders, low-stock alerts — each with one-tap action
 * buttons where it makes sense.
 *
 * Contract (every export):
 * - STRICTLY BEST EFFORT. Nothing here may ever fail the calling flow — a
 *   Telegram outage, a Blob hiccup or a corrupt owner record must not break
 *   a booking webhook or a client's order. Every entry point catches and
 *   logs; none of them throw.
 * - Silent no-op when TELEGRAM_BOT_TOKEN is unset or no owner is bound.
 *   Note the deliberate asymmetry with the webhook route: there a corrupt
 *   owner record fails CLOSED (security boundary); here it just means "no
 *   push today" (pure convenience, nothing is exposed or executed).
 *
 * One-tap actions REUSE the existing confirmation machinery end to end: each
 * button is a pending action on Blob (validateMutationArgs → describeMutation
 * → createPendingAction) and its callback_data is `confirm:<id>` — exactly
 * what the Telegram webhook's callback handler executes, with the same
 * atomic exactly-once claims, owner-only checks and audit trail. The pushed
 * button itself IS the confirmation step (Victoria's tap = approval),
 * consistent with the chat flow where the inline keyboard is the gate.
 * Pushed pendings use NOTIFY_PENDING_TTL_MS (7 days) — Victoria may tap a
 * notification button hours later; the 15-minute chat default would kill it.
 *
 * Language: notifications are EN (Victoria's admin/notification surfaces are
 * EN throughout); client names, treatments and product names interpolate
 * with control characters stripped (see pushSafe) but otherwise as-is, so
 * Russian content renders naturally.
 */

/** Canned decline reason — Cal.com emails it to the client verbatim. */
const DECLINE_REASON = "Schedule conflict — please pick another time";

/**
 * Canned cancellation note for the order push's [Cancel order] button. It is
 * stored as cancel reason { code: "other", note } and INCLUDED in the
 * client's cancellation email, so it must read well client-side — codes like
 * "out-of-stock" or "client-request" would be guesses; "other" + a neutral
 * apology is the honest default for a one-tap cancel.
 */
const ORDER_CANCEL_REASON =
  "Sorry — we are unable to fulfil this order right now. Please contact us if you have any questions.";

/** Products at or below this tracked quantity trigger a low-stock alert. */
export const LOW_STOCK_THRESHOLD = 3;

// --- core helpers -------------------------------------------------------------

/**
 * The owner chat to push to, or null when pushes must silently no-op
 * (no bot token, no binding, or an unreadable owner record). Never throws.
 */
async function ownerForPush(): Promise<number | null> {
  if (!telegramConfigured()) return null;
  try {
    return await getOwnerChatId();
  } catch (error) {
    console.error("[notify] Owner record unreadable — skipping push:", error);
    return null;
  }
}

/**
 * Send a push to the bound owner. Best effort: swallows and logs every
 * failure; returns whether Telegram accepted the message.
 */
export async function notifyOwner(
  text: string,
  keyboard?: InlineKeyboard
): Promise<boolean> {
  try {
    const owner = await ownerForPush();
    if (owner === null) return false;
    const result = await sendMessage(
      owner,
      text,
      keyboard ? { replyMarkup: keyboard } : {}
    );
    return result.ok;
  } catch (error) {
    console.error("[notify] Owner push failed:", error);
    return false;
  }
}

interface PushButton {
  text: string;
  callback_data: string;
}

/**
 * Strip control characters (\r, \n, \t and friends) from client-controlled
 * text interpolated into owner pushes — names, item titles, phones. Without
 * this, a crafted booking/order "name" containing newlines could forge
 * extra lines or fields inside a notification Victoria trusts. Normal
 * content (incl. Russian) passes through unchanged.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]+/g;
function pushSafe(value: unknown): string {
  return String(value ?? "").replace(CONTROL_CHARS_RE, " ").trim();
}

/**
 * Park a mutation as a long-TTL pending action and return its inline button.
 * Validates args through the same gate as chat-initiated mutations so what
 * Victoria's tap executes is exactly what was disclosed; the summary keeps
 * the human context AND the structural disclosure line from describeMutation
 * (the tap edits the message to `summary + result`).
 *
 * `ids` lets paired buttons (Confirm/Decline on one push) pre-generate both
 * pending ids and cross-link them as siblings — the webhook executor
 * discards the sibling after a winning claim (see PendingAction.siblingId).
 */
async function pushActionButton(
  owner: number,
  label: string,
  tool: string,
  args: Record<string, unknown>,
  context: string,
  ids?: { id: string; siblingId: string }
): Promise<PushButton | null> {
  const validated = validateMutationArgs(tool, args);
  if (!validated.ok) {
    console.error(`[notify] Refusing ${tool} button: ${validated.error}`);
    return null;
  }
  const pending = await createPendingAction({
    chatId: owner,
    tool,
    args: validated.args,
    summary: `${context}\n${describeMutation(tool, validated.args)}`,
    ttlMs: NOTIFY_PENDING_TTL_MS,
    ...(ids ? { id: ids.id, siblingId: ids.siblingId } : {}),
  });
  return { text: label, callback_data: `confirm:${pending.id}` };
}

function keyboard(buttons: PushButton[]): InlineKeyboard | undefined {
  return buttons.length > 0 ? { inline_keyboard: [buttons] } : undefined;
}

// --- booking pushes -------------------------------------------------------------

/**
 * "🔔 New booking request" push with one-tap [✅ Confirm | ❌ Decline].
 * Confirm executes booking_confirm(uid); Decline executes booking_decline
 * with the canned schedule-conflict reason (a one-tap decline cannot ask for
 * free text — for a custom reason Victoria declines via chat instead).
 */
export async function notifyBookingRequest(
  details: BookingDetails
): Promise<void> {
  try {
    const owner = await ownerForPush();
    if (owner === null || !details.uid) return;

    const name = pushSafe(details.attendeeName);
    const service = pushSafe(details.service);
    const phone = pushSafe(details.attendeePhone);
    const when = formatCairoTime(details.start);
    const headline =
      `🔔 New booking request — ${name}, ` +
      `${service}, ${when}, ${phone}`;
    const context = `Booking request: ${name} — ${service}, ${when}`;

    // Confirm and Decline are cross-linked siblings: whichever wins its
    // claim retires the other (see PendingAction.siblingId).
    const confirmId = crypto.randomUUID();
    const declineId = crypto.randomUUID();
    const buttons: PushButton[] = [];
    const confirmBtn = await pushActionButton(
      owner,
      "✅ Confirm",
      "booking_confirm",
      { uid: details.uid },
      context,
      { id: confirmId, siblingId: declineId }
    );
    if (confirmBtn) buttons.push(confirmBtn);
    const declineBtn = await pushActionButton(
      owner,
      "❌ Decline",
      "booking_decline",
      { uid: details.uid, reason: DECLINE_REASON },
      context,
      { id: declineId, siblingId: confirmId }
    );
    if (declineBtn) buttons.push(declineBtn);

    await sendMessage(owner, headline, { replyMarkup: keyboard(buttons) });
  } catch (error) {
    console.error("[notify] Booking-request push failed:", error);
  }
}

/** Informational push when a booking is cancelled — no buttons. */
export async function notifyBookingCancelled(
  details: BookingDetails
): Promise<void> {
  const when = formatCairoTime(details.start);
  const reason = details.reason ? ` Reason: ${pushSafe(details.reason)}` : "";
  await notifyOwner(
    `❌ ${pushSafe(details.attendeeName)} cancelled ${pushSafe(details.service)} on ${when}.${reason}`
  );
}

// --- order pushes ----------------------------------------------------------------

/**
 * "🛍 New order" push with one-tap [✅ Mark confirmed | ❌ Cancel order].
 * Both run order_set_status through the existing executor (which also sends
 * the client's status email and restores stock on cancel).
 */
export async function notifyNewOrder(order: StoredOrder): Promise<void> {
  try {
    const owner = await ownerForPush();
    if (owner === null) return;

    const buyer = pushSafe(order.name);
    const phone = pushSafe(order.phone);
    const itemCount = order.items.reduce((sum, i) => sum + i.qty, 0);
    const itemList = order.items
      .map((i) => `${i.qty}× ${pushSafe(i.names.en)}`)
      .join(", ");
    const headline =
      `🛍 New order ${order.orderNumber} — ${buyer}, ` +
      `${order.totals.egp} EGP, ${itemCount} item(s): ${itemList}, ${phone}`;
    const context = `Order ${order.orderNumber}: ${buyer}, ${order.totals.egp} EGP`;

    // Mark-confirmed and Cancel are cross-linked siblings (see
    // PendingAction.siblingId): the first winning tap retires the other, so
    // a day-3 Cancel tap can't cancel an order confirmed (and possibly
    // shipped) on day 1 just because an editMessageText failed.
    const confirmId = crypto.randomUUID();
    const cancelId = crypto.randomUUID();
    const buttons: PushButton[] = [];
    const confirmBtn = await pushActionButton(
      owner,
      "✅ Mark confirmed",
      "order_set_status",
      { orderNumber: order.orderNumber, status: "confirmed" },
      context,
      { id: confirmId, siblingId: cancelId }
    );
    if (confirmBtn) buttons.push(confirmBtn);
    const cancelBtn = await pushActionButton(
      owner,
      "❌ Cancel order",
      "order_set_status",
      {
        orderNumber: order.orderNumber,
        status: "cancelled",
        reason: ORDER_CANCEL_REASON,
      },
      context,
      { id: cancelId, siblingId: confirmId }
    );
    if (cancelBtn) buttons.push(cancelBtn);

    await sendMessage(owner, headline, { replyMarkup: keyboard(buttons) });
  } catch (error) {
    console.error("[notify] New-order push failed:", error);
  }
}

// --- stock pushes -----------------------------------------------------------------

export interface StockChange {
  slug: string;
  /** EN product name for the alert text. */
  name: string;
  /** Tracked quantity before the decrement. */
  before: number;
  /** Tracked quantity after the decrement (floored at 0). */
  after: number;
}

/**
 * Stock alerts after an order's decrement:
 * - CROSSING to 1..LOW_STOCK_THRESHOLD (from above it): "⚠️ down to N left"
 *   with a one-tap [🚫 Mark sold out] button (product_update soldOut:true).
 *   Crossing-only so a product sitting at 2 doesn't re-alert every order.
 * - Hitting 0: informational only — effectiveSoldOut() already hides it from
 *   sale automatically, so there is nothing to tap.
 */
export async function notifyStockChanges(
  changes: StockChange[]
): Promise<void> {
  try {
    const relevant = changes.filter(
      (c) =>
        (c.before > 0 && c.after === 0) ||
        (c.before > LOW_STOCK_THRESHOLD &&
          c.after <= LOW_STOCK_THRESHOLD &&
          c.after > 0)
    );
    if (relevant.length === 0) return;
    const owner = await ownerForPush();
    if (owner === null) return;

    for (const change of relevant) {
      const name = pushSafe(change.name);
      if (change.after === 0) {
        await sendMessage(
          owner,
          `⚠️ ${name} just hit 0 in stock — it now shows as sold out on the site automatically.`
        );
        continue;
      }
      const soldOutBtn = await pushActionButton(
        owner,
        "🚫 Mark sold out",
        "product_update",
        { slug: change.slug, soldOut: true },
        `Low stock: ${name} — ${change.after} left`
      );
      await sendMessage(
        owner,
        `⚠️ ${name} down to ${change.after} left`,
        { replyMarkup: keyboard(soldOutBtn ? [soldOutBtn] : []) }
      );
    }
  } catch (error) {
    console.error("[notify] Stock-change push failed:", error);
  }
}
