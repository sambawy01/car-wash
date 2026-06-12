import { NextRequest, NextResponse } from "next/server";
import { cairoDateKey, cairoHourNow } from "@/lib/daily-brief-email";
import { brandedEmailHtml, escapeHtml } from "@/lib/branded-email";
import {
  buildBackupSnapshot,
  rotateBackups,
  writeBackup,
  BACKUP_KEEP,
} from "@/lib/reports/backup";
import {
  cairoWeekdayNow,
  cronAuthError,
  isForced,
  sendReportEmail,
} from "@/lib/reports/shared";

/**
 * Monday-03:00-Cairo business backup — GET, triggered by the GitHub Actions
 * workflow .github/workflows/cron-backup.yml.
 *
 * Auth: Bearer CRON_SECRET, fail closed.
 *
 * DST-proofing: the workflow fires Mondays at BOTH 00:00 and 01:00 UTC; this
 * guard only proceeds when Cairo wall time is Monday 03:00 (00:00 UTC →
 * 02:00/03:00 Cairo, both still Monday). `?force=1` bypasses the guard
 * outside production only.
 *
 * Behavior (see @/lib/reports/backup for the snapshot/restore contract):
 * 1. Snapshot every business blob (orders/*, both catalogs, audit log) as
 *    raw text → backups/YYYY-MM-DD.json (Cairo date).
 * 2. Rotate: keep the newest BACKUP_KEEP (8) snapshots, delete older — the
 *    rotation rule can only ever match this job's own naming scheme.
 * 3. Email the snapshot as a .json attachment to NOTIFY_EMAIL so a copy
 *    lives outside the Blob store. Email failure never undoes the stored
 *    snapshot — the Blob write is the primary artifact.
 *
 * No Telegram push: a binary attachment ritual belongs in email; failures
 * surface in the Actions run (non-200 fails the workflow).
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = cronAuthError(request);
  if (unauthorized) return unauthorized;

  const force = isForced(request);
  const cairoHour = cairoHourNow();
  const cairoWeekday = cairoWeekdayNow();
  if (!force && !(cairoWeekday === "Mon" && cairoHour === 3)) {
    return NextResponse.json({
      skipped: "not Monday 03:00 Cairo",
      cairoWeekday,
      cairoHour,
    });
  }

  // 1. Snapshot. A listing failure here is fatal (500) — the workflow run
  //    goes red, which IS the alarm for a broken backup pipeline.
  let snapshot;
  try {
    snapshot = await buildBackupSnapshot();
  } catch (error) {
    console.error("[backup] Snapshot failed:", error);
    return NextResponse.json(
      { error: "snapshot-failed", detail: String(error) },
      { status: 500 }
    );
  }

  const dateKey = cairoDateKey(new Date());
  const { pathname, json } = await writeBackup(snapshot, dateKey);

  // 2. Rotation — best effort; a delete hiccup must not fail the backup.
  let deleted: string[] = [];
  try {
    ({ deleted } = await rotateBackups());
  } catch (error) {
    console.error("[backup] Rotation failed (snapshot is safe):", error);
  }

  // 3. Email the snapshot as an attachment.
  const filename = `${dateKey}.json`;
  const summary = [
    `Weekly business backup — ${dateKey}`,
    "",
    `Files captured: ${snapshot.files.length}`,
    ...(snapshot.truncated
      ? ["WARNING: orders listing hit its cap — snapshot is INCOMPLETE."]
      : []),
    ...(snapshot.missing.length
      ? [`Missing/unreadable: ${snapshot.missing.join(", ")}`]
      : []),
    `Stored at: ${pathname} (newest ${BACKUP_KEEP} kept)`,
    `Snapshot size: ${(json.length / 1024).toFixed(1)} KB`,
    "",
    "The full snapshot is attached. To restore a file, write its `text`",
    "back to its `pathname` in the Blob store — byte-faithful by design.",
  ].join("\n");

  const contentHtml =
    `<p style="margin:0 0 8px;color:#3A332C;font-size:15px;line-height:1.6;">Files captured: <strong>${snapshot.files.length}</strong></p>` +
    (snapshot.truncated
      ? `<p style="margin:0 0 8px;color:#B3261E;font-size:15px;line-height:1.6;"><strong>WARNING:</strong> orders listing hit its cap — this snapshot is incomplete.</p>`
      : "") +
    (snapshot.missing.length
      ? `<p style="margin:0 0 8px;color:#3A332C;font-size:15px;line-height:1.6;">Missing/unreadable: ${escapeHtml(snapshot.missing.join(", "))}</p>`
      : "") +
    `<p style="margin:0 0 8px;color:#3A332C;font-size:15px;line-height:1.6;">Stored at <strong>${escapeHtml(pathname)}</strong> · newest ${BACKUP_KEEP} kept · ${(json.length / 1024).toFixed(1)} KB</p>` +
    `<p style="margin:16px 0 0;color:#847866;font-size:14px;">The full snapshot is attached as ${escapeHtml(filename)}. To restore a file, write its <code>text</code> back to its <code>pathname</code> in the Blob store.</p>`;

  const email = await sendReportEmail(
    {
      subject: `Weekly backup — ${dateKey} (${snapshot.files.length} files)`,
      text: summary,
      html: brandedEmailHtml({
        heading: `Weekly backup — ${dateKey}`,
        contentHtml,
      }),
      attachments: [
        {
          filename,
          contentBase64: Buffer.from(json, "utf8").toString("base64"),
        },
      ],
    },
    "backup"
  );

  return NextResponse.json({
    ok: true,
    cairoWeekday,
    cairoHour,
    forced: force,
    pathname,
    files: snapshot.files.length,
    truncated: snapshot.truncated,
    missing: snapshot.missing,
    bytes: json.length,
    rotatedOut: deleted,
    email,
  });
}
