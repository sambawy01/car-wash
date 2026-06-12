import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  parseBookingLang,
  sendAttendeeEmail,
  sendOwnerNotificationEmail,
  type AttendeeEmailKind,
  type BookingDetails,
} from "@/lib/booking-emails";

/**
 * Cal.com webhook receiver.
 *
 * Trust model (defense in depth):
 * 1. Preferred: HMAC-SHA256 signature check. Cal signs the raw request body
 *    with the webhook `secret` and sends the hex digest in the
 *    `x-cal-signature-256` header. We verify with a timing-safe compare.
 * 2. Fallback (secret unset, header missing, or mismatch): we do NOT trust the
 *    payload. Instead we fetch the booking by uid from the Cal API and build
 *    the emails from that canonical data. A forged payload can therefore at
 *    worst trigger an email about a real, existing booking.
 *
 * Routing (branded emails replace/augment Cal's generic ones):
 * - BOOKING_REQUESTED, or BOOKING_CREATED while still pending
 *     → Victoria's "New booking request" + attendee "request received".
 * - BOOKING_CREATED with status accepted — this is what Cal fires when the
 *   host CONFIRMS a pending booking (verified in cal.com
 *   handleConfirmation.ts; there is no BOOKING_CONFIRMED/ACCEPTED trigger)
 *     → attendee "your appointment is confirmed".
 * - BOOKING_REJECTED → attendee decline email (incl. Cal's rejectionReason).
 * - BOOKING_CANCELLED → attendee cancellation email (incl. cancellationReason).
 *
 * Attendee language: `payload.metadata.lang` ("en"/"ru"), recorded by
 * /api/booking-calendar/book at creation time. The confirmation-time
 * BOOKING_CREATED payload does NOT carry booking metadata (Cal only sends
 * { videoCallUrl } there), so when lang is missing we fetch the canonical
 * booking — GET /bookings/{uid} (2024-08-13) returns the stored metadata.
 * Fallback: "en".
 *
 * This route must NEVER break bookings: every handled outcome returns 200,
 * email failures are logged. Only malformed JSON returns 400.
 */

interface WebhookAttendee {
  name?: string;
  email?: string;
  timeZone?: string;
  phoneNumber?: string;
}

interface WebhookPayload {
  uid?: string;
  bookingId?: number;
  title?: string;
  eventTitle?: string;
  type?: string;
  status?: string;
  startTime?: string;
  endTime?: string;
  /** Event type length in minutes (spread from Cal's eventTypeInfo). */
  length?: number;
  attendees?: WebhookAttendee[];
  responses?: Record<string, { label?: string; value?: unknown } | undefined>;
  metadata?: Record<string, unknown> | null;
  rejectionReason?: string;
  cancellationReason?: string;
}

interface WebhookBody {
  triggerEvent?: string;
  createdAt?: string;
  payload?: WebhookPayload;
}

function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.trim().toLowerCase();
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function minutesBetween(startIso: string, endIso: string): number | null {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  return Math.round((end - start) / 60_000);
}

/** Canonical booking lookup — used for untrusted payloads and lang backfill. */
async function fetchBookingFromCal(
  uid: string
): Promise<BookingDetails | null> {
  const apiUrl = process.env.CALCOM_API_URL;
  const apiKey = process.env.CALCOM_API_KEY;
  if (!apiUrl || !apiKey) return null;
  try {
    const res = await fetch(`${apiUrl}/bookings/${encodeURIComponent(uid)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "cal-api-version": "2024-08-13",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: {
        uid: string;
        title?: string;
        status?: string;
        start?: string;
        end?: string;
        duration?: number;
        cancellationReason?: string;
        eventType?: { slug?: string };
        attendees?: WebhookAttendee[];
        bookingFieldsResponses?: Record<string, unknown>;
        metadata?: Record<string, unknown> | null;
      };
    };
    const b = json.data;
    if (!b?.uid) return null;
    const attendee = b.attendees?.[0] ?? {};
    const rawNotes = b.bookingFieldsResponses?.notes;
    return {
      uid: b.uid,
      service: b.title || b.eventType?.slug || "Booking",
      start: b.start || "",
      durationMinutes:
        typeof b.duration === "number" && b.duration > 0
          ? b.duration
          : b.start && b.end
            ? minutesBetween(b.start, b.end)
            : null,
      status: (b.status || "").toLowerCase(),
      attendeeName: attendee.name || "Unknown",
      attendeeEmail: attendee.email || "unknown",
      attendeePhone: attendee.phoneNumber || "not provided",
      notes: typeof rawNotes === "string" ? rawNotes : "",
      lang: parseBookingLang(b.metadata?.lang),
      reason: typeof b.cancellationReason === "string" ? b.cancellationReason : "",
    };
  } catch (error) {
    console.error("[cal-webhook] Cal API lookup failed:", error);
    return null;
  }
}

function detailsFromPayload(payload: WebhookPayload): BookingDetails {
  const attendee = payload.attendees?.[0] ?? {};
  const responsePhone = payload.responses?.attendeePhoneNumber?.value;
  const responseNotes = payload.responses?.notes?.value;
  const reason = payload.rejectionReason || payload.cancellationReason || "";
  return {
    uid: payload.uid || "",
    service: payload.eventTitle || payload.title || payload.type || "Booking",
    start: payload.startTime || "",
    durationMinutes:
      typeof payload.length === "number" && payload.length > 0
        ? payload.length
        : payload.startTime && payload.endTime
          ? minutesBetween(payload.startTime, payload.endTime)
          : null,
    status: (payload.status || "").toLowerCase(),
    attendeeName: attendee.name || "Unknown",
    attendeeEmail: attendee.email || "unknown",
    attendeePhone:
      attendee.phoneNumber ||
      (typeof responsePhone === "string" ? responsePhone : "") ||
      "not provided",
    notes: typeof responseNotes === "string" ? responseNotes : "",
    lang: parseBookingLang(payload.metadata?.lang),
    reason: typeof reason === "string" ? reason : "",
  };
}

export async function POST(request: NextRequest) {
  let rawBody: string;
  let body: WebhookBody;
  try {
    rawBody = await request.text();
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const triggerEvent = (body.triggerEvent || "").toUpperCase();
  const payload = body.payload ?? {};
  const uid = payload.uid || "";

  // --- authenticate the webhook -------------------------------------------
  const secret = process.env.CAL_WEBHOOK_SECRET;
  const signatureValid = secret
    ? verifySignature(rawBody, request.headers.get("x-cal-signature-256"), secret)
    : false;

  let details: BookingDetails | null = null;
  if (signatureValid) {
    details = detailsFromPayload(payload);
  } else if (uid) {
    // Untrusted payload: only the uid is used; everything in the emails comes
    // from the canonical booking fetched from the Cal API.
    details = await fetchBookingFromCal(uid);
    if (!details) {
      console.warn(
        `[cal-webhook] Unverified payload and booking uid not found on Cal — ignoring (trigger=${triggerEvent}, uid=${uid})`
      );
      return NextResponse.json({ received: true, ignored: "unverified" });
    }
  } else {
    console.warn(
      `[cal-webhook] Unverified payload without booking uid — ignoring (trigger=${triggerEvent})`
    );
    return NextResponse.json({ received: true, ignored: "unverified" });
  }

  // --- route by trigger -----------------------------------------------------
  const isPending = details.status.includes("pending");
  const isRequested =
    triggerEvent === "BOOKING_REQUESTED" ||
    (triggerEvent === "BOOKING_CREATED" && isPending);

  let attendeeKind: AttendeeEmailKind | null = null;
  if (isRequested) {
    attendeeKind = "requested";
  } else if (
    triggerEvent === "BOOKING_CREATED" &&
    details.status.includes("accepted")
  ) {
    // Cal fires BOOKING_CREATED (status ACCEPTED) when the host confirms a
    // pending booking — and for event types booked without confirmation.
    attendeeKind = "confirmed";
  } else if (triggerEvent === "BOOKING_REJECTED") {
    attendeeKind = "rejected";
  } else if (triggerEvent === "BOOKING_CANCELLED") {
    attendeeKind = "cancelled";
  }

  if (!attendeeKind) {
    console.log(
      `[cal-webhook] Received ${triggerEvent || "UNKNOWN"} for uid=${details.uid} (status=${details.status}) — no email needed`
    );
    return NextResponse.json({ received: true, emailed: false });
  }

  // Backfill lang from the canonical booking when the payload lacks it (the
  // confirmation-time BOOKING_CREATED payload never carries booking metadata).
  if (details.lang === null && details.uid) {
    const canonical = await fetchBookingFromCal(details.uid);
    if (canonical?.lang) details.lang = canonical.lang;
  }

  // Victoria's notification only for new requests; attendee email for every
  // lifecycle step. Failures are logged and reported — never re-thrown, and
  // the attendee email is never blocked by an owner-email failure.
  let ownerSent = false;
  if (isRequested) {
    ownerSent = (await sendOwnerNotificationEmail(details)).sent;
  }
  const attendeeResult = await sendAttendeeEmail(attendeeKind, details);

  return NextResponse.json({
    received: true,
    emailed: isRequested ? ownerSent : attendeeResult.sent,
    attendeeEmail: { kind: attendeeKind, sent: attendeeResult.sent },
  });
}
