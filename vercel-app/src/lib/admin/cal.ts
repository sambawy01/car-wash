/**
 * Server-only Cal.com v2 helpers for the owner booking-review page.
 * All calls use the CALCOM_API_KEY — never expose these from the client.
 *
 * Verified against api.cal.eu/v2 (cal-api-version 2024-08-13):
 * - GET  /bookings?status=upcoming,unconfirmed   → list (comma-joined filters work)
 * - GET  /bookings?afterStart=…&beforeEnd=…&take=…
 *   → list across ALL statuses (incl. past) inside a time window
 * - POST /bookings/{uid}/confirm                 → accept a pending booking
 * - POST /bookings/{uid}/decline  {reason}       → reject; reason reaches the
 *   attendee via Cal's rejection email
 * - POST /bookings/{uid}/reschedule {start, reschedulingReason}
 *   → REBOOKS the booking to the new start time immediately
 * - GET/POST /me/ooo, DELETE /me/ooo/{id}        → out-of-office entries.
 *   NOTE (verified empirically on this account): Cal normalizes OOO entries
 *   to WHOLE DAYS (00:00:00Z → 23:59:59Z) regardless of the supplied times,
 *   and while an entry exists GET /v2/slots returns NO slots for those days
 *   (so they cannot be booked). Deleting the entry restores the slots after
 *   a short Cal-side cache lag (~20 s).
 */

const CAL_API_VERSION = "2024-08-13";

/**
 * Hard timeout on every Cal.com call. Vassili's agent loop and the webhook
 * route run under an execution deadline — an unresponsive Cal upstream must
 * surface as a tool error, not hang until the function is killed.
 */
const CAL_FETCH_TIMEOUT_MS = 12_000;

export interface CalAttendee {
  name: string;
  email: string;
  timeZone: string;
}

export interface CalBooking {
  id: number;
  uid: string;
  title: string;
  description?: string;
  status: "pending" | "accepted" | "cancelled" | "rejected" | string;
  start: string;
  end: string;
  duration: number;
  eventTypeId: number;
  eventType?: { id: number; slug: string };
  attendees: CalAttendee[];
  bookingFieldsResponses?: Record<string, unknown>;
}

interface CalEnv {
  apiUrl: string;
  apiKey: string;
}

function getCalEnv(): CalEnv {
  const apiUrl = process.env.CALCOM_API_URL;
  const apiKey = process.env.CALCOM_API_KEY;
  if (!apiUrl || !apiKey) {
    throw new Error("Cal.com API is not configured (CALCOM_API_URL / CALCOM_API_KEY)");
  }
  return { apiUrl, apiKey };
}

function calHeaders(apiKey: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "cal-api-version": CAL_API_VERSION,
  };
}

/** Pending requests + upcoming confirmed bookings, sorted by start time. */
export async function listOwnerBookings(): Promise<CalBooking[]> {
  const { apiUrl, apiKey } = getCalEnv();
  const res = await fetch(
    `${apiUrl}/bookings?status=upcoming,unconfirmed&take=100`,
    {
      headers: calHeaders(apiKey),
      cache: "no-store",
      signal: AbortSignal.timeout(CAL_FETCH_TIMEOUT_MS),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cal.com list failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { status: string; data: CalBooking[] };
  const bookings = Array.isArray(json.data) ? json.data : [];
  return bookings.sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );
}

/**
 * All bookings (any status, including past/cancelled) whose start falls in
 * [afterStartIso, beforeEndIso], sorted by start time. Used by Vassili's
 * stats_summary and client_history tools.
 */
export async function listBookingsInRange(
  afterStartIso: string,
  beforeEndIso: string,
  take = 250
): Promise<CalBooking[]> {
  const { apiUrl, apiKey } = getCalEnv();
  const params = new URLSearchParams({
    afterStart: afterStartIso,
    beforeEnd: beforeEndIso,
    take: String(take),
  });
  const res = await fetch(`${apiUrl}/bookings?${params}`, {
    headers: calHeaders(apiKey),
    cache: "no-store",
    signal: AbortSignal.timeout(CAL_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cal.com range list failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { status: string; data: CalBooking[] };
  const bookings = Array.isArray(json.data) ? json.data : [];
  return bookings.sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );
}

export interface CalActionResult {
  ok: boolean;
  status: number;
  body: unknown;
}

async function postBookingAction(
  uid: string,
  action: "confirm" | "decline" | "reschedule",
  body?: Record<string, unknown>
): Promise<CalActionResult> {
  const { apiUrl, apiKey } = getCalEnv();
  const res = await fetch(
    `${apiUrl}/bookings/${encodeURIComponent(uid)}/${action}`,
    {
      method: "POST",
      headers: calHeaders(apiKey),
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(CAL_FETCH_TIMEOUT_MS),
    }
  );
  let parsed: unknown;
  const text = await res.text();
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

export function confirmBooking(uid: string): Promise<CalActionResult> {
  return postBookingAction(uid, "confirm");
}

/** The reason is included in Cal's rejection email to the attendee. */
export function declineBooking(uid: string, reason: string): Promise<CalActionResult> {
  return postBookingAction(uid, "decline", { reason });
}

/** Rebooks immediately to the new UTC start time (ISO 8601). */
export function rescheduleBooking(
  uid: string,
  startIsoUtc: string,
  reschedulingReason?: string
): Promise<CalActionResult> {
  return postBookingAction(uid, "reschedule", {
    start: startIsoUtc,
    ...(reschedulingReason ? { reschedulingReason } : {}),
  });
}

// --- Out-of-office (calendar blocking) ----------------------------------------

export interface CalOutOfOffice {
  id: number;
  uuid?: string;
  start: string;
  end: string;
  notes?: string | null;
  reason?: string | null;
}

/**
 * Block whole calendar days with an out-of-office entry (see module docs:
 * Cal normalizes to full days and removes ALL bookable slots for them).
 * `startDate`/`endDate` are YYYY-MM-DD, inclusive.
 */
export async function createOutOfOffice(
  startDate: string,
  endDate: string,
  notes?: string
): Promise<CalActionResult> {
  const { apiUrl, apiKey } = getCalEnv();
  const res = await fetch(`${apiUrl}/me/ooo`, {
    method: "POST",
    headers: calHeaders(apiKey),
    signal: AbortSignal.timeout(CAL_FETCH_TIMEOUT_MS),
    body: JSON.stringify({
      start: `${startDate}T00:00:00.000Z`,
      end: `${endDate}T23:59:59.999Z`,
      reason: "unspecified",
      ...(notes ? { notes } : {}),
    }),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

/** All current out-of-office entries for the API-key user. */
export async function listOutOfOffice(): Promise<CalOutOfOffice[]> {
  const { apiUrl, apiKey } = getCalEnv();
  const res = await fetch(`${apiUrl}/me/ooo`, {
    headers: calHeaders(apiKey),
    cache: "no-store",
    signal: AbortSignal.timeout(CAL_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cal.com OOO list failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { status: string; data: CalOutOfOffice[] };
  return Array.isArray(json.data) ? json.data : [];
}

/** Remove an out-of-office entry (re-opens the blocked days for booking). */
export async function deleteOutOfOffice(id: number): Promise<CalActionResult> {
  const { apiUrl, apiKey } = getCalEnv();
  const res = await fetch(`${apiUrl}/me/ooo/${encodeURIComponent(String(id))}`, {
    method: "DELETE",
    headers: calHeaders(apiKey),
    signal: AbortSignal.timeout(CAL_FETCH_TIMEOUT_MS),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { ok: res.ok, status: res.status, body: parsed };
}
