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
 *   window (cairoHourNow / cairoWeekdayNow). One firing runs, the other
 *   returns {skipped}. Schedule jitter therefore can never double-fire.
 * - `?force=1` bypasses the time guard, but ONLY outside production.
 */

const CAIRO_TZ = "Africa/Cairo";
const NOTIFY_EMAIL_DEFAULT = "victoria@victoriaholisticbeauty.com";
const EMAIL_FROM =
  "Victoria Holistic Beauty <bookings@victoriaholisticbeauty.com>";

// --- cron route guards ---------------------------------------------------------

/** Bearer CRON_SECRET, fail closed. Returns the 401 response or null (pass). */
export function cronAuthError(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
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
