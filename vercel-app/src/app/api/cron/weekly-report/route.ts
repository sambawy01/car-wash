import { NextRequest, NextResponse } from "next/server";
import { cairoHourNow } from "@/lib/daily-brief-email";
import {
  buildWeeklyReportEmail,
  gatherWeeklyReportData,
} from "@/lib/reports/weekly-report";
import {
  cairoWeekdayNow,
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
 * guard only proceeds when Cairo wall time is Sunday 18:00 — one firing
 * sends, the other returns {skipped}. Both UTC firings stay on Sunday in
 * Cairo (17:00/18:00 local), so the weekday check can't drift either.
 * `?force=1` bypasses the guard outside production only.
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

  const data = await gatherWeeklyReportData();
  const report = buildWeeklyReportEmail(data);

  const email = await sendReportEmail(
    { subject: report.subject, text: report.text, html: report.html },
    "weekly-report"
  );
  const telegram = await pushOwnerTelegram(report.text, "weekly-report");

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
