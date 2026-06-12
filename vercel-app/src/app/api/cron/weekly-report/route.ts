import { NextRequest, NextResponse } from "next/server";
import { cairoDateKey, cairoHourNow } from "@/lib/daily-brief-email";
import {
  buildWeeklyReportEmail,
  gatherWeeklyReportData,
} from "@/lib/reports/weekly-report";
import {
  cairoWeekdayNow,
  claimDailySend,
  cronAuthError,
  isForced,
  pushOwnerTelegram,
  sendReportEmail,
} from "@/lib/reports/shared";

/**
 * Sunday-18:00-Cairo weekly report — GET, triggered by the GitHub Actions
 * workflow .github/workflows/cron-weekly-report.yml.
 *
 * Auth: Bearer CRON_SECRET, fail closed.
 *
 * DST-proofing: the workflow fires Sundays at BOTH 15:00 and 16:00 UTC; this
 * guard only proceeds when Cairo wall time is Sunday 18:00 — normally one
 * firing sends and the other returns {skipped}. Both UTC firings stay on
 * Sunday in Cairo (17:00/18:00 local), so the weekday check can't drift.
 * The wall-clock guard alone is not airtight (60-minute-plus Actions delays
 * can land both firings in the window; a prod workflow_dispatch passes it
 * too), so the route also claims a per-day marker before sending
 * (claimDailySend). `?force=1` bypasses the guard outside production only.
 *
 * Content: this week vs last week (Cairo Mon–Sun weeks) — confirmed
 * bookings, top treatments, order count + EGP revenue, cancellations.
 * The builder takes `extraSections` so the future finance-ledger P&L can
 * slot in without touching this route (see @/lib/reports/weekly-report).
 *
 * Unlike the evening digest, the weekly report ALWAYS sends — a quiet week
 * is itself information, and a weekly cadence can't become noise.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = cronAuthError(request);
  if (unauthorized) return unauthorized;

  const force = isForced(request);
  const cairoHour = cairoHourNow();
  const cairoWeekday = cairoWeekdayNow();
  if (!force && !(cairoWeekday === "Sun" && cairoHour === 18)) {
    return NextResponse.json({
      skipped: "not Sunday 18:00 Cairo",
      cairoWeekday,
      cairoHour,
    });
  }

  // Double-fire guard: claim today's marker (claims pattern, fail closed).
  // `force` (non-production only) bypasses the marker entirely — it neither
  // checks nor claims, so dev/preview test sends never suppress the real
  // Sunday send. Tri-state outcome: a genuine pre-existing marker is the
  // quiet already-sent skip; ANY other claim failure (Blob outage) still
  // refuses to send but answers 500 so the GitHub Actions run goes red
  // instead of silently losing the report for the week.
  if (!force) {
    const claim = await claimDailySend("weekly-report", cairoDateKey(new Date()));
    if (claim === "already-sent") {
      return NextResponse.json({
        ok: true,
        cairoWeekday,
        cairoHour,
        skipped: "already sent today (day marker)",
      });
    }
    if (claim === "error") {
      return NextResponse.json(
        {
          ok: false,
          cairoWeekday,
          cairoHour,
          error:
            "day-marker claim failed (Blob error, not a conflict) — report NOT sent this firing; retry via workflow_dispatch once Blob recovers",
        },
        { status: 500 }
      );
    }
  }

  const data = await gatherWeeklyReportData();
  const report = buildWeeklyReportEmail(data);

  const email = await sendReportEmail(
    { subject: report.subject, text: report.text, html: report.html },
    "weekly-report"
  );
  const telegram = await pushOwnerTelegram(report.text, "weekly-report");

  // The claim is already burned for today (correct — it must stand to keep
  // the no-duplicates guarantee), but a report that reached NO channel must
  // be loud: 500 with a top-level error field (the workflows' jq filter
  // surfaces `error`, and `test "${code}" = "200"` fails the run).
  if (email.sentCount === 0 && !telegram.sent) {
    return NextResponse.json(
      {
        ok: false,
        cairoWeekday,
        cairoHour,
        forced: force,
        subject: report.subject,
        email,
        telegram,
        error:
          "report delivered on NO channel (email and telegram both failed); day marker stands — no automatic retry",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    cairoWeekday,
    cairoHour,
    forced: force,
    subject: report.subject,
    thisWeek: data.thisWeek,
    lastWeek: data.lastWeek,
    failures: data.failures,
    email,
    telegram,
  });
}
