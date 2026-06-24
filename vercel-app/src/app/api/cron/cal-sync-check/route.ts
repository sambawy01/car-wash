import { NextRequest, NextResponse } from "next/server";
import { cairoHourNow } from "@/lib/daily-brief-email";
import { brandedEmailHtml, escapeHtml } from "@/lib/branded-email";
import { checkCalSync, driftAlertText } from "@/lib/reports/cal-sync";
import {
  cairoWeekdayNow,
  cronAuthError,
  isForced,
  pushOwnerTelegram,
  sendReportEmail,
} from "@/lib/reports/shared";

/**
 * Monday-09:00-Cairo Cal.com drift check — GET, triggered by the GitHub
 * Actions workflow .github/workflows/cron-cal-sync-check.yml.
 *
 * Auth: Bearer CRON_SECRET, fail closed.
 *
 * DST-proofing: the workflow fires Mondays at BOTH 06:00 and 07:00 UTC; this
 * guard only proceeds when Cairo wall time is Monday 09:00. `?force=1`
 * bypasses the guard outside production only.
 *
 * READ-ONLY against Cal: verifies every catalog treatment's event type
 * (exists / title / duration / hidden-matches-active — see
 * @/lib/reports/cal-sync).
 *
 * Drift → Telegram + branded email listing every mismatch.
 * Clean → SILENT (response JSON only). Transient Cal fetch errors are
 * returned/logged but never page the team on their own.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = cronAuthError(request);
  if (unauthorized) return unauthorized;

  const force = isForced(request);
  const cairoHour = cairoHourNow();
  const cairoWeekday = cairoWeekdayNow();
  if (!force && !(cairoWeekday === "Mon" && cairoHour === 9)) {
    return NextResponse.json({
      skipped: "not Monday 09:00 Cairo",
      cairoWeekday,
      cairoHour,
    });
  }

  // Catalog read / Cal env failures are fatal (500): the workflow run goes
  // red in Actions, which is the alarm for a check that couldn't run at all.
  let result;
  try {
    result = await checkCalSync();
  } catch (error) {
    console.error("[cal-sync-check] Check failed:", error);
    return NextResponse.json(
      { error: "check-failed", detail: String(error) },
      { status: 500 }
    );
  }

  if (result.drift.length === 0) {
    // Clean → silent. Errors (if any) ride the response for the Actions log.
    return NextResponse.json({
      ok: true,
      cairoWeekday,
      cairoHour,
      forced: force,
      checked: result.checked,
      skippedTreatments: result.skipped,
      drift: [],
      errors: result.errors,
    });
  }

  const alertText = driftAlertText(result);

  const driftLines = result.drift
    .map(
      (d) =>
        `<p style="margin:0 0 8px;color:#0A1A2F;font-size:15px;line-height:1.6;"><strong>${escapeHtml(d.slug)}</strong> (event type ${d.eventTypeId || "none"}): ${escapeHtml(d.problem)}</p>`
    )
    .join("");
  const errorLines = result.errors.length
    ? `<p style="margin:16px 0 8px;color:#4A5568;font-size:14px;">Could not verify (transient Cal errors):</p>` +
      result.errors
        .map(
          (e) =>
            `<p style="margin:0 0 8px;color:#4A5568;font-size:14px;">${escapeHtml(e)}</p>`
        )
        .join("")
    : "";

  const email = await sendReportEmail(
    {
      subject: `Cal sync drift — ${result.drift.length} mismatch${result.drift.length === 1 ? "" : "es"} found`,
      text: alertText,
      html: brandedEmailHtml({
        heading: "Cal.com sync drift detected",
        contentHtml:
          `<p style="margin:0 0 16px;color:#0A1A2F;font-size:15px;line-height:1.6;">The weekly check found mismatches between the treatments catalog and Cal.com:</p>` +
          driftLines +
          errorLines +
          `<p style="margin:24px 0 0;color:#4A5568;font-size:14px;">Fix from the treatments admin (re-saving a treatment re-syncs its Cal event type), or adjust the event type on Cal.com.</p>`,
      }),
    },
    "cal-sync-check"
  );
  const telegram = await pushOwnerTelegram(alertText, "cal-sync-check");

  return NextResponse.json({
    ok: true,
    cairoWeekday,
    cairoHour,
    forced: force,
    checked: result.checked,
    skippedTreatments: result.skipped,
    drift: result.drift,
    errors: result.errors,
    email,
    telegram,
  });
}
