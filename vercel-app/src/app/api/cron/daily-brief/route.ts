import { NextRequest, NextResponse } from "next/server";
import { listOwnerBookings, type CalBooking } from "@/lib/admin/cal";
import { listOrders, type StoredOrder } from "@/lib/orders";
import {
  buildDailyBriefEmail,
  cairoHourNow,
  sendDailyBriefEmail,
} from "@/lib/daily-brief-email";

/**
 * Daily 8am-Cairo brief to Victoria — GET, triggered by Vercel Cron.
 *
 * Auth: Vercel invokes cron routes with `Authorization: Bearer ${CRON_SECRET}`
 * whenever the CRON_SECRET env var exists on the project. We require it and
 * fail closed (401 when CRON_SECRET is unset or the header mismatches).
 *
 * DST-proofing: Cairo flips between UTC+2 and UTC+3, but Vercel cron schedules
 * are fixed UTC. vercel.json therefore fires this route at BOTH 05:00 and
 * 06:00 UTC, and this guard only proceeds when the current Africa/Cairo hour
 * is exactly 8 — one firing sends, the other returns {skipped}.
 *
 * Testing escape hatch: `?force=1` bypasses the hour guard, but ONLY outside
 * production (NODE_ENV check) — the schedule can never be forced in prod.
 *
 * Data failures are soft: if Cal or Blob is down the brief still goes out
 * with a "couldn't load X" note, so Victoria always gets her morning email.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // --- auth: fail closed --------------------------------------------------
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // --- 8am-Cairo guard ------------------------------------------------------
  const force =
    process.env.NODE_ENV !== "production" &&
    request.nextUrl.searchParams.get("force") === "1";
  const cairoHour = cairoHourNow();
  if (!force && cairoHour !== 8) {
    return NextResponse.json({ skipped: "not 8am Cairo", cairoHour });
  }

  // --- gather data (fail-soft per source) -----------------------------------
  const failures: string[] = [];

  let bookings: CalBooking[] = [];
  try {
    bookings = await listOwnerBookings();
  } catch (error) {
    console.error("[daily-brief] Failed to load Cal bookings:", error);
    failures.push("today's bookings");
  }

  let orders: StoredOrder[] = [];
  try {
    orders = await listOrders();
  } catch (error) {
    console.error("[daily-brief] Failed to load shop orders:", error);
    failures.push("shop orders");
  }

  // --- build + send -----------------------------------------------------------
  const brief = buildDailyBriefEmail({ bookings, orders, failures });
  const result = await sendDailyBriefEmail(brief);

  return NextResponse.json({
    ok: true,
    cairoHour,
    forced: force,
    subject: brief.subject,
    counts: brief.counts,
    failures,
    email: result,
  });
}
