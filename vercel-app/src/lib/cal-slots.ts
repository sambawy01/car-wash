/**
 * Server-only Cal.com v2 slots helper (cal-api-version 2024-09-04).
 *
 * Shared by the public booking calendar route (/api/booking-calendar/slots)
 * and the admin move-booking route (/api/admin/slots) so both surfaces always
 * see exactly the same availability. Uses CALCOM_API_URL / CALCOM_API_KEY —
 * never call this from the client.
 */

export interface CalSlot {
  start: string;
  attendees?: number;
  bookingUid?: string;
}

/** Slots keyed by Cal's date bucket: { "2026-06-17": [{ start: "…" }] } */
export type CalSlotsByDate = Record<string, CalSlot[]>;

export type CalSlotsResult =
  | { ok: true; data: CalSlotsByDate }
  | {
      ok: false;
      /**
       * Error provenance — callers branch on this, never on `error` text:
       * - "upstream": Cal.com answered the slots request with a non-2xx HTTP
       *   status (`status` is Cal's status; the public route echoes it in the
       *   body).
       * - "config": CALCOM_API_URL / CALCOM_API_KEY missing — nothing was
       *   fetched.
       * - "internal": network/runtime failure or an unexpected Cal payload
       *   (HTTP 2xx but non-success envelope).
       */
      kind: "upstream" | "config" | "internal";
      status: number;
      error: string;
      details?: unknown;
    };

export async function fetchCalSlots(params: {
  eventTypeId: string;
  /** YYYY-MM-DD (inclusive) */
  dateFrom: string;
  /** YYYY-MM-DD (inclusive) */
  dateTo: string;
  /** Explicit duration for multi-duration event types */
  duration?: string | null;
}): Promise<CalSlotsResult> {
  const { eventTypeId, dateFrom, dateTo, duration } = params;

  if (!process.env.CALCOM_API_KEY || !process.env.CALCOM_API_URL) {
    return {
      ok: false,
      kind: "config",
      status: 500,
      error: "Cal.com API not configured (CALCOM_API_URL / CALCOM_API_KEY)",
    };
  }

  try {
    // Convert dates to proper ISO format with time for v2 API
    const startTime = new Date(dateFrom + "T00:00:00.000Z").toISOString();
    const endTime = new Date(dateTo + "T23:59:59.999Z").toISOString();

    // Build v2 API URL with correct parameter names
    const apiUrl = new URL(`${process.env.CALCOM_API_URL}/slots`);
    apiUrl.searchParams.set("eventTypeId", eventTypeId);
    apiUrl.searchParams.set("start", startTime);
    apiUrl.searchParams.set("end", endTime);
    // Optional: specific duration for multi-duration event types
    if (duration && !isNaN(parseInt(duration, 10))) {
      apiUrl.searchParams.set("duration", duration);
    }

    const response = await fetch(apiUrl.toString(), {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CALCOM_API_KEY}`,
        "cal-api-version": "2024-09-04",
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Cal.com v2 Slots API error:", {
        status: response.status,
        statusText: response.statusText,
        eventTypeId,
        errorData: errorData,
      });
      return {
        ok: false,
        kind: "upstream",
        status: response.status,
        error: "Failed to fetch available slots from Cal.com",
        details: errorData,
      };
    }

    const responseData = await response.json();

    // v2 API returns { status: "success", data: {...} }
    if (responseData.status === "success") {
      return { ok: true, data: responseData.data as CalSlotsByDate };
    }
    console.error("Cal.com v2 API returned non-success status:", responseData);
    // HTTP 2xx but a non-success envelope: tagged "internal" (not "upstream")
    // because there is no upstream HTTP status worth echoing to callers.
    return {
      ok: false,
      kind: "internal",
      status: 500,
      error: "Cal.com API returned error status",
      details: responseData,
    };
  } catch (error) {
    console.error("Error fetching Cal.com slots:", error);
    return {
      ok: false,
      kind: "internal",
      status: 500,
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
