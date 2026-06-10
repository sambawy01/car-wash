/**
 * Server-only Cal.com v2 helpers for the owner booking-review page.
 * All calls use the CALCOM_API_KEY — never expose these from the client.
 *
 * Verified against api.cal.eu/v2 (cal-api-version 2024-08-13):
 * - GET  /bookings?status=upcoming,unconfirmed   → list (comma-joined filters work)
 * - POST /bookings/{uid}/confirm                 → accept a pending booking
 * - POST /bookings/{uid}/decline  {reason}       → reject; reason reaches the
 *   attendee via Cal's rejection email
 * - POST /bookings/{uid}/reschedule {start, reschedulingReason}
 *   → REBOOKS the booking to the new start time immediately
 */

const CAL_API_VERSION = "2024-08-13";

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
    { headers: calHeaders(apiKey), cache: "no-store" }
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
