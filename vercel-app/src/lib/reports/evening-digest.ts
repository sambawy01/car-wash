import { brandedEmailHtml, escapeHtml } from "../branded-email";
import { cairoDateKey } from "../daily-brief-email";
import type { CalBooking } from "../admin/cal";
import type { StoredOrder } from "../orders";
import { cairoClock, cairoDayAndClock, cairoSubjectDate } from "./shared";

/**
 * the team's 20:00-Cairo evening digest (/api/cron/evening-digest):
 *
 * - "Tomorrow's appointments": confirmed bookings starting TOMORROW in Cairo
 *   — the evening preview of the next working day.
 * - "Pending requests waiting 12h+": booking requests still unconfirmed 12+
 *   hours after the client created them (createdAt from Cal; a booking with
 *   NO readable createdAt is INCLUDED — fail toward visibility, a stuck
 *   request must never hide behind a missing timestamp).
 * - "Orders stuck in 'ordered' 48h+": shop orders never confirmed within two
 *   days of being placed.
 *
 * EMPTY-STATE POLICY (deliberate, opposite of the morning brief): when all
 * three sections are empty the digest is SKIPPED ENTIRELY — no Telegram, no
 * email. The morning brief is the daily heartbeat ("a missing brief means a
 * delivery problem"); the evening digest is an action nudge, and an evening
 * "nothing needs you" message every single day is pure noise. EXCEPTION:
 * when a data source failed to load, the digest still goes out with the
 * failure note — "empty because we couldn't look" must not masquerade as a
 * genuinely quiet evening.
 */

export interface EveningDigestInput {
  /** All bookings from GET /bookings?status=upcoming,unconfirmed. */
  bookings: CalBooking[];
  /** All stored shop orders (any status — filtered here). */
  orders: StoredOrder[];
  /** Data sources that failed to load — surfaced, and they suppress the skip. */
  failures: string[];
  /** "Now" — injectable for tests. */
  now?: Date;
}

export interface EveningDigest {
  /** True → nothing to say, the cron route sends NOTHING. */
  empty: boolean;
  subject: string;
  text: string;
  html: string;
  counts: { tomorrow: number; stalePending: number; staleOrders: number };
}

const PENDING_STALE_MS = 12 * 60 * 60 * 1000;
const ORDER_STALE_MS = 48 * 60 * 60 * 1000;

/** "Facial Massage between Elite Eco Car Wash and X" → "Facial Massage". */
function serviceTitle(booking: CalBooking): string {
  const title = booking.title || "Booking";
  const idx = title.indexOf(" between ");
  return idx > 0 ? title.slice(0, idx) : title;
}

function bookingPhone(booking: CalBooking): string {
  const value = booking.bookingFieldsResponses?.["attendeePhoneNumber"];
  return typeof value === "string" && value.trim() ? value.trim() : "no phone";
}

/**
 * Cal v2 bookings carry `createdAt` (verified live on api.cal.eu,
 * cal-api-version 2024-08-13) but our CalBooking interface doesn't declare
 * it — read it defensively off the raw object.
 */
function bookingCreatedAtMs(booking: CalBooking): number | null {
  const raw = (booking as unknown as { createdAt?: unknown }).createdAt;
  if (typeof raw !== "string") return null;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function buildEveningDigest(input: EveningDigestInput): EveningDigest {
  const now = input.now ?? new Date();
  // +24h from a 20:00-Cairo instant always lands on the next Cairo calendar
  // day (a 1h DST shift moves the local time, never the date).
  const tomorrowKey = cairoDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  const tomorrow = input.bookings
    .filter(
      (b) =>
        (b.status || "").toLowerCase() === "accepted" &&
        cairoDateKey(new Date(b.start)) === tomorrowKey
    )
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const stalePendingCutoff = now.getTime() - PENDING_STALE_MS;
  const stalePending = input.bookings
    .filter((b) => {
      if ((b.status || "").toLowerCase() !== "pending") return false;
      const createdMs = bookingCreatedAtMs(b);
      // Unknown age → include (see module docs: fail toward visibility).
      return createdMs === null || createdMs <= stalePendingCutoff;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const staleOrderCutoff = now.getTime() - ORDER_STALE_MS;
  const staleOrders = input.orders.filter((o) => {
    if (o.status !== "ordered") return false;
    const createdMs = new Date(o.createdAt).getTime();
    return !Number.isNaN(createdMs) && createdMs <= staleOrderCutoff;
  });

  const empty =
    tomorrow.length === 0 &&
    stalePending.length === 0 &&
    staleOrders.length === 0 &&
    input.failures.length === 0;

  const subjectDate = cairoSubjectDate(now);
  const subject = `Evening digest — ${subjectDate}: ${tomorrow.length} tomorrow, ${stalePending.length + staleOrders.length} need action`;

  const adminToken = process.env.ADMIN_TOKEN || "";
  const adminBase = "https://book.eliteecocarwash.com/admin";
  const adminLink = adminToken
    ? `${adminBase}?key=${encodeURIComponent(adminToken)}`
    : adminBase;

  // --- text part -------------------------------------------------------------
  const textLines: string[] = [`Good evening! Tomorrow at a glance.`, ""];

  if (input.failures.length) {
    textLines.push(
      `Heads up: couldn't load ${input.failures.join(" and ")} — the sections below may be incomplete.`,
      ""
    );
  }

  textLines.push(`Tomorrow's appointments (${tomorrow.length})`);
  if (tomorrow.length === 0) {
    textLines.push("  None confirmed for tomorrow.");
  } else {
    for (const b of tomorrow) {
      textLines.push(
        `  ${cairoClock(b.start)} · ${serviceTitle(b)} · ${b.attendees?.[0]?.name || "Unknown"} · ${bookingPhone(b)}`
      );
    }
  }

  textLines.push("", `Pending requests waiting 12h+ (${stalePending.length})`);
  if (stalePending.length === 0) {
    textLines.push("  None — nothing has been waiting on you.");
  } else {
    for (const b of stalePending) {
      textLines.push(
        `  ${cairoDayAndClock(b.start)} · ${serviceTitle(b)} · ${b.attendees?.[0]?.name || "Unknown"} — still awaiting your confirmation`
      );
    }
    textLines.push(`  Review them here: ${adminLink}`);
  }

  textLines.push("", `Orders stuck in "ordered" 48h+ (${staleOrders.length})`);
  if (staleOrders.length === 0) {
    textLines.push("  None — every order has been picked up.");
  } else {
    for (const o of staleOrders) {
      const items = o.items.map((i) => `${i.qty}× ${i.names.en}`).join(", ");
      textLines.push(
        `  ${o.orderNumber} · ${o.name} · ${o.phone} · ${o.totals.egp} EGP — ${items}`
      );
    }
    textLines.push(`  Manage orders here: ${adminLink}`);
  }

  textLines.push("", "Rest well!", "— your booking assistant");
  const text = textLines.join("\n");

  // --- html part ---------------------------------------------------------------
  const sectionTitle = (title: string) =>
    `<p style="margin:28px 0 8px;color:#4A5568;font-size:13px;text-transform:uppercase;letter-spacing:0.12em;">${escapeHtml(title)}</p>`;
  const line = (content: string, muted = false) =>
    `<p style="margin:0 0 8px;color:${muted ? "#4A5568" : "#0A1A2F"};font-size:15px;line-height:1.6;">${content}</p>`;
  const adminButton = (label: string) =>
    `<p style="margin:12px 0 0;"><a href="${adminLink}" style="display:inline-block;background-color:#0A1A2F;color:#FFFFFF;text-decoration:none;padding:10px 24px;border-radius:9999px;font-size:14px;">${escapeHtml(label)}</a></p>`;

  let contentHtml = "";

  if (input.failures.length) {
    contentHtml += `<div style="margin:0 0 16px;padding:12px 16px;border:1px solid #D1D9E0;border-radius:10px;background-color:#F8FAFC;"><p style="margin:0;color:#0A1A2F;font-size:14px;">Heads up: couldn't load ${escapeHtml(input.failures.join(" and "))} — the sections below may be incomplete.</p></div>`;
  }

  contentHtml += sectionTitle(`Tomorrow's appointments (${tomorrow.length})`);
  if (tomorrow.length === 0) {
    contentHtml += line("None confirmed for tomorrow.", true);
  } else {
    for (const b of tomorrow) {
      contentHtml += line(
        `<strong>${escapeHtml(cairoClock(b.start))}</strong> · ${escapeHtml(serviceTitle(b))} · ${escapeHtml(b.attendees?.[0]?.name || "Unknown")} · ${escapeHtml(bookingPhone(b))}`
      );
    }
  }

  contentHtml += sectionTitle(
    `Pending requests waiting 12h+ (${stalePending.length})`
  );
  if (stalePending.length === 0) {
    contentHtml += line("None — nothing has been waiting on you.", true);
  } else {
    for (const b of stalePending) {
      contentHtml += line(
        `${escapeHtml(cairoDayAndClock(b.start))} · ${escapeHtml(serviceTitle(b))} · ${escapeHtml(b.attendees?.[0]?.name || "Unknown")} — <em>still awaiting your confirmation</em>`
      );
    }
    contentHtml += adminButton("Open booking inbox");
  }

  contentHtml += sectionTitle(
    `Orders stuck in "ordered" 48h+ (${staleOrders.length})`
  );
  if (staleOrders.length === 0) {
    contentHtml += line("None — every order has been picked up.", true);
  } else {
    for (const o of staleOrders) {
      const items = o.items.map((i) => `${i.qty}× ${i.names.en}`).join(", ");
      contentHtml += line(
        `<strong>${escapeHtml(o.orderNumber)}</strong> · ${escapeHtml(o.name)} · ${escapeHtml(o.phone)} · ${escapeHtml(String(o.totals.egp))} EGP<br><span style="color:#4A5568;font-size:14px;">${escapeHtml(items)}</span>`
      );
    }
    contentHtml += adminButton("Open admin");
  }

  contentHtml += `<p style="margin:28px 0 0;color:#4A5568;font-size:14px;">Rest well!<br>— your booking assistant</p>`;

  const html = brandedEmailHtml({
    heading: `Tomorrow at a glance — ${subjectDate}`,
    contentHtml,
    belowCardHtml: "Times shown in Cairo time (Africa/Cairo).",
  });

  return {
    empty,
    subject,
    text,
    html,
    counts: {
      tomorrow: tomorrow.length,
      stalePending: stalePending.length,
      staleOrders: staleOrders.length,
    },
  };
}
