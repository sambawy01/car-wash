import { NextRequest, NextResponse } from "next/server";
import {
  isAuthorizedAdminRequest,
  unauthorizedResponse,
} from "@/lib/admin/auth";
import { fetchCalSlots } from "@/lib/cal-slots";

/**
 * Available Cal.com slots for the admin move-booking flow. Passes through to
 * the SAME helper as the public /api/booking-calendar/slots route so the
 * admin inbox offers exactly the times a client would see on /book.
 *
 * Auth: the proxy already gates /api/admin/*; this re-check is defense in
 * depth (Basic auth or the legacy x-admin-key / ?key= token).
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return unauthorizedResponse();
  }

  const { searchParams } = new URL(request.url);
  const eventTypeId = searchParams.get("eventTypeId");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const duration = searchParams.get("duration");

  if (!eventTypeId || !dateFrom || !dateTo) {
    return NextResponse.json(
      { error: "Missing required parameters: eventTypeId, dateFrom, dateTo" },
      { status: 400 }
    );
  }

  const result = await fetchCalSlots({ eventTypeId, dateFrom, dateTo, duration });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status }
    );
  }

  // Same shape as the public route: { "2026-06-17": [{ "start": "…" }] }
  return NextResponse.json(result.data);
}
