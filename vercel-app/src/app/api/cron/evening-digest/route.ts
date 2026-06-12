import { NextRequest, NextResponse } from "next/server";
import { cairoDateKey, cairoHourNow } from "@/lib/daily-brief-email";
import { gatherDailyBriefData } from "@/lib/daily-brief-data";
import { buildEveningDigest } from "@/lib/reports/evening-digest";
import {
  claimDailySend,
  cronAuthError,
  isForced,
  pushOwnerTelegram,
  sendReportEmail,
} from "@/lib/reports/shared";

/**
 * 20:00-Cairo evening digest — GET, triggered by the GitHub Actions workflow
 * .github/workflows/cron-evening-digest.yml (Vercel Hobby's 2-cron cap is
 * fully used by the daily brief, so all fleet jobs ride GitHub cron).
 *
 * Auth: Bearer CRON_SECRET, fail closed (same contract as the daily brief).
 *
 * DST-proofing: the workflow fires at BOTH 17:00 and 18:00 UTC; this guard
 * only proceeds when the Africa/Cairo hour is exactly 20 — normally one
 * firing sends and the other returns {skipped}. The hour guard alone is not
 * airtight (60-minute-plus Actions delays can land both firings in the
 * window; a prod workflow_dispatch passes it too), so a non-empty digest
 * also claims a per-day marker before sending (claimDailySend). `?force=1`
 * bypasses the guard outside production only.
 *
 * Content: tomorrow's confirmed appointments + pending requests waiting
 * 12h+ + orders stuck in "ordered" 48h+ (see @/lib/reports/evening-digest).
 *
 * EMPTY STATE: skipped entirely — no Telegram, no email. The morning brief
 * is the guaranteed daily heartbeat; the evening digest only speaks when
 * something actually needs Victoria, so it never trains her to ignore it.
 * (Exception: data-source failures still send, with a warning — documented
 * in the builder.)
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = cronAuthError(request);
  if (unauthorized) return unauthorized;

  const force = isForced(request);
  const cairoHour = cairoHourNow();
  if (!force && cairoHour !== 20) {
    return NextResponse.json({ skipped: "not 20:00 Cairo", cairoHour });
  }

  // Same fail-soft gather as the morning brief — bookings + orders.
  const { bookings, orders, failures } = await gatherDailyBriefData();
  const digest = buildEveningDigest({ bookings, orders, failures });

  if (digest.empty) {
    return NextResponse.json({
      ok: true,
      cairoHour,
      forced: force,
      skipped: "empty digest — nothing needs attention tonight",
      counts: digest.counts,
    });
  }

  // Double-fire guard: claim today's marker before sending (claims pattern,
  // fail closed). An empty digest above deliberately does NOT claim — if a
  // booking lands between two same-window firings, the later one may still
  // deliver it. `force` (non-production only) bypasses the marker entirely:
  // it neither checks nor claims, so dev/preview test sends never suppress
  // the real scheduled send.
  if (!force && !(await claimDailySend("evening-digest", cairoDateKey(new Date())))) {
    return NextResponse.json({
      ok: true,
      cairoHour,
      forced: force,
      skipped: "already sent today (day marker)",
    });
  }

  const email = await sendReportEmail(
    { subject: digest.subject, text: digest.text, html: digest.html },
    "evening-digest"
  );
  const telegram = await pushOwnerTelegram(digest.text, "evening-digest");

  return NextResponse.json({
    ok: true,
    cairoHour,
    forced: force,
    subject: digest.subject,
    counts: digest.counts,
    failures,
    email,
    telegram,
  });
}
