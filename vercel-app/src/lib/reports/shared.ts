import { createHash, timingSafeEqual } from "node:crypto";
import { del, put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { getOwnerChatId } from "../assistant/state";
import { sendMessage, telegramConfigured } from "../telegram";

/**
 * Shared plumbing for the scheduled-job fleet (/api/cron/* beyond the
 * daily brief). Every job follows the daily-brief contract:
 *
 * - Auth: `Authorization: Bearer ${CRON_SECRET}`, FAIL CLOSED (401 when the
 *   secret is unset or mismatched). The GitHub Actions workflows in
 *   .github/workflows/cron-*.yml send this header.
 * - DST-proof scheduling: Cairo flips between UTC+2 and UTC+3, and GitHub
 *   cron is fixed UTC — so each workflow fires at BOTH candidate UTC hours
 *   and the route only proceeds when the Africa/Cairo wall clock matches its
 *   window (cairoHourNow / cairoWeekdayNow). Normally one firing runs and
 *   the other returns {skipped} — but the wall-clock guard alone is NOT
 *   airtight: GitHub schedule delays of 60+ minutes can land BOTH firings
 *   inside the same Cairo window, and a production workflow_dispatch during
 *   the window passes it too. Jobs that send owner email therefore ALSO
 *   claim a per-day marker (claimDailySend below) before sending.
 * - `?force=1` bypasses the time guard, but ONLY outside production.
 */

const CAIRO_TZ = "Africa/Cairo";
const NOTIFY_EMAIL_DEFAULT = "info@eliteecocarwash.com";
const EMAIL_FROM =
  "Elite Eco Car Wash <bookings@eliteecocarwash.com>";

// --- cron route guards ---------------------------------------------------------

/**
 * Constant-time string equality. Compares fixed-length sha256 digests so
 * the comparison itself leaks neither contents nor length (timingSafeEqual
 * requires equal-length inputs; hashing first removes the length channel).
 */
function safeSecretEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(da, db);
}

/**
 * Bearer CRON_SECRET, fail closed (401 when the secret is unset or the
 * header mismatches — constant-time). Returns the 401 response or null
 * (pass). Shared by every /api/cron/* route including the daily brief.
 */
export function cronAuthError(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !safeSecretEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Outcome of a day-marker claim:
 * - "claimed"      — THIS call wrote the marker; proceed with the send.
 * - "already-sent" — the marker already existed (the other firing won);
 *                    skip quietly, this is the guard working as designed.
 * - "error"        — the claim could not be proven either way (Blob outage,
 *                    auth failure, malformed key). The caller must NOT send
 *                    (fail closed on duplicates) AND must answer non-2xx so
 *                    the GitHub Actions run goes red — a bare skip here
 *                    silently loses the job for the whole day.
 */
export type DailyClaimResult = "claimed" | "already-sent" | "error";

/**
 * The @vercel/blob SDK surfaces an `allowOverwrite: false` conflict as a
 * plain BlobError whose message is "Vercel Blob: This blob already exists,
 * use `allowOverwrite: true` …" (no error-code property — verified
 * empirically against the live API; every other failure mode is a distinct
 * subclass/message: BlobServiceNotAvailable, BlobAccessError, network
 * TypeError, …). The message substring is therefore the only available
 * discriminator between "lost the race" and "Blob is down".
 */
const BLOB_CONFLICT_RE = /blob already exists/i;

/**
 * Claim today's send for a job — the codebase's exactly-once claims pattern
 * (see claimPending in ../assistant/state.ts): the Blob API enforces
 * `allowOverwrite: false` server-side, so when two firings race, exactly
 * one put of reports/sent/<job>/<cairoDateKey>.json succeeds.
 *
 * This closes the double-fire windows the Cairo wall-clock guard cannot:
 * both UTC firings landing in the same Cairo window under 60-minute-plus
 * GitHub schedule delays, and a production workflow_dispatch during the
 * window.
 *
 * FAIL CLOSED, but LOUD: a firing that cannot PROVE it claimed first never
 * sends (duplicate owner emails are the harm this exists to prevent) — yet
 * only a genuine pre-existing marker is a quiet "already-sent" skip. Any
 * other failure is "error", which callers turn into HTTP 500 so the cron
 * workflow goes red instead of silently losing the day. The same-day retry
 * path is workflow_dispatch; the next day gets a fresh marker regardless.
 *
 * Markers are a few bytes each and never swept (a year of daily jobs is
 * well under a thousand tiny blobs) — deliberate: keeping them makes the
 * guard immune to a sweeping bug resurrecting a day.
 */
export async function claimDailySend(
  job: string,
  cairoDateKey: string
): Promise<DailyClaimResult> {
  // Internal-only inputs, but never let a malformed key write a stray path.
  // A malformed key is a programming bug, not a lost race — report "error"
  // (→ 500) so it can never masquerade as a normal already-sent skip.
  if (!/^[a-z0-9-]+$/.test(job) || !/^\d{4}-\d{2}-\d{2}$/.test(cairoDateKey)) {
    console.error(`[reports] Invalid day-marker key: ${job}/${cairoDateKey}`);
    return "error";
  }
  try {
    await put(
      `reports/sent/${job}/${cairoDateKey}.json`,
      JSON.stringify({ sentAt: new Date().toISOString() }),
      {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: false,
      }
    );
    return "claimed";
  } catch (error) {
    if (error instanceof Error && BLOB_CONFLICT_RE.test(error.message)) {
      return "already-sent";
    }
    console.error(
      `[reports] Day-marker claim failed for ${job}/${cairoDateKey} (Blob error, NOT a conflict):`,
      error
    );
    return "error";
  }
}

/**
 * Release (delete) a previously-claimed day marker.
 *
 * Used by a job that claimed the marker but then delivered on NO channel —
 * deleting the marker lets the SAME day be re-driven (a workflow_dispatch
 * retry, or the other DST firing in the same window) instead of the burned
 * marker permanently suppressing the day. Only the TOTAL-failure path should
 * call this; a partial success keeps the marker so the job is not re-sent.
 *
 * Best-effort: a delete failure is logged, not thrown (the caller is already
 * on its error path). Returns true when the marker was deleted.
 */
export async function releaseDailySend(
  job: string,
  cairoDateKey: string
): Promise<boolean> {
  if (!/^[a-z0-9-]+$/.test(job) || !/^\d{4}-\d{2}-\d{2}$/.test(cairoDateKey)) {
    console.error(`[reports] Invalid day-marker key (release): ${job}/${cairoDateKey}`);
    return false;
  }
  try {
    await del(`reports/sent/${job}/${cairoDateKey}.json`);
    return true;
  } catch (error) {
    console.error(
      `[reports] Day-marker release failed for ${job}/${cairoDateKey}:`,
      error
    );
    return false;
  }
}

/** `?force=1` time-guard bypass — never honored in production. */
export function isForced(request: NextRequest): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    request.nextUrl.searchParams.get("force") === "1"
  );
}

export type CairoWeekday =
  | "Mon"
  | "Tue"
  | "Wed"
  | "Thu"
  | "Fri"
  | "Sat"
  | "Sun";

/** Current weekday in Cairo ("Mon".."Sun") — DST-proof cron guard. */
export function cairoWeekdayNow(now: Date = new Date()): CairoWeekday {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CAIRO_TZ,
    weekday: "short",
  }).format(now) as CairoWeekday;
}

// --- Cairo formatting helpers (shared by the digest/report builders) -------------

/** "15:00" in Cairo. */
export function cairoClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "??:??";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CAIRO_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

/** "Thu 18 Jun 15:00" in Cairo. */
export function cairoDayAndClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CAIRO_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(d)
    .replace(",", "");
}

/** "Thu 12 Jun" in Cairo — subject-line date. */
export function cairoSubjectDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CAIRO_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(date)
    .replace(",", "");
}

// --- owner Telegram push (best effort, never throws) ------------------------------

export interface TelegramPushResult {
  sent: boolean;
  reason?: string;
}

/**
 * Push plain text to the bound owner chat — same policy as the daily brief:
 * best effort, any failure is reported in the result, never thrown, so it
 * can never break an email path that already completed.
 */
export async function pushOwnerTelegram(
  text: string,
  logTag: string
): Promise<TelegramPushResult> {
  if (!telegramConfigured()) {
    return { sent: false, reason: "telegram-not-configured" };
  }
  try {
    const ownerChatId = await getOwnerChatId();
    if (ownerChatId === null) {
      return { sent: false, reason: "no-owner-bound" };
    }
    const sent = await sendMessage(ownerChatId, text);
    return sent.ok
      ? { sent: true }
      : { sent: false, reason: `telegram-${sent.status}` };
  } catch (error) {
    console.error(`[${logTag}] Telegram push failed:`, error);
    return { sent: false, reason: "telegram-error" };
  }
}

// --- branded report email sender (never throws) -----------------------------------

export interface ReportEmailAttachment {
  filename: string;
  /** Base64-encoded content — Resend's attachment wire format. */
  contentBase64: string;
}

export interface ReportEmail {
  subject: string;
  text: string;
  html: string;
  attachments?: ReportEmailAttachment[];
}

export interface ReportEmailResult {
  sent: boolean;
  sentCount: number;
  failedCount: number;
  reason?: string;
}

/**
 * Send a branded report email to every NOTIFY_EMAIL recipient — one Resend
 * call per recipient so a single bounced inbox can't block the other owner
 * address (the established owner-email pattern). When RESEND_API_KEY is
 * unset this is a graceful no-op that logs what WOULD have been sent — the
 * verification path for local runs with a blanked key.
 */
export async function sendReportEmail(
  email: ReportEmail,
  logTag: string
): Promise<ReportEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const recipients = (process.env.NOTIFY_EMAIL || NOTIFY_EMAIL_DEFAULT)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!apiKey) {
    for (const recipient of recipients) {
      console.log(
        `[${logTag}] RESEND_API_KEY not set — would email ${recipient}:\nSubject: ${email.subject}\n${email.text}`
      );
    }
    return {
      sent: false,
      sentCount: 0,
      failedCount: 0,
      reason: "email-not-configured",
    };
  }

  const attachments = (email.attachments ?? []).map((a) => ({
    filename: a.filename,
    content: a.contentBase64,
  }));

  const outcomes = await Promise.all(
    recipients.map(async (recipient): Promise<boolean> => {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: EMAIL_FROM,
            to: [recipient],
            subject: email.subject,
            text: email.text,
            html: email.html,
            ...(attachments.length ? { attachments } : {}),
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          console.error(
            `[${logTag}] Resend send to ${recipient} failed (${res.status}): ${body.slice(0, 300)}`
          );
          return false;
        }
        console.log(`[${logTag}] Sent to ${recipient}: ${email.subject}`);
        return true;
      } catch (error) {
        console.error(
          `[${logTag}] Resend request error for ${recipient}:`,
          error
        );
        return false;
      }
    })
  );

  const sentCount = outcomes.filter(Boolean).length;
  return {
    sent: sentCount > 0,
    sentCount,
    failedCount: outcomes.length - sentCount,
  };
}
