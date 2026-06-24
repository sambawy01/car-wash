import { brandedEmailHtml, escapeHtml } from "./branded-email";

/**
 * All booking-related emails sent from /api/cal/webhook:
 *
 * 1. Owner notification — "New booking request" with the admin
 *    inbox link (English only; the owner's working language for the inbox).
 * 2. Attendee lifecycle emails (the branded replacement for Cal.com's generic
 *    ones) — bilingual EN/AR from the booking's `metadata.lang`:
 *      - requested   → "We received your booking request"
 *      - confirmed   → "Your appointment is confirmed"
 *      - rejected    → "About your booking request" (decline + rebook invite)
 *      - cancelled   → "About your booking" (cancellation + rebook invite)
 *      - rescheduled → "Your appointment has been moved" (old time → new time)
 *
 * Every HTML body goes through `brandedEmailHtml` (dark logo band header).
 * Text parts stay plain. Senders NEVER throw — the webhook must always 200.
 */

const NOTIFY_EMAIL_DEFAULT = "info@eliteecocarwash.com";
const ADMIN_URL_BASE = "https://book.eliteecocarwash.com/admin";
const BOOK_URL = "https://book.eliteecocarwash.com/book";
const OWNER_EMAIL_FROM =
  "Elite Eco Car Wash <bookings@eliteecocarwash.com>";
const ATTENDEE_EMAIL_FROM =
  "Elite Eco Car Wash <bookings@eliteecocarwash.com>";
const ATTENDEE_REPLY_TO = "info@eliteecocarwash.com";

export type BookingLang = "en" | "ar";

export type AttendeeEmailKind =
  | "requested"
  | "confirmed"
  | "rejected"
  | "cancelled"
  | "rescheduled";

export interface BookingDetails {
  uid: string;
  service: string;
  start: string;
  /** Duration in minutes when known (from payload length or end − start). */
  durationMinutes: number | null;
  status: string;
  attendeeName: string;
  attendeeEmail: string;
  attendeePhone: string;
  /** Client notes incl. the "Services: …" line for combined sessions. */
  notes: string;
  /** UI language recorded at booking time (metadata.lang); null = unknown. */
  lang: BookingLang | null;
  /** Cal's rejectionReason / cancellationReason when present. */
  reason: string;
  /**
   * Previous start time (ISO) for reschedules — payload.rescheduleStartTime,
   * or backfilled from the old booking via rescheduledFromUid. null = unknown.
   */
  oldStart?: string | null;
}

export function parseBookingLang(value: unknown): BookingLang | null {
  return value === "ar" || value === "en" ? value : null;
}

export function formatCairoTime(iso: string, lang: BookingLang = "en"): string {
  if (!iso) return lang === "ar" ? "وقت غير معروف" : "unknown time";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
    timeZone: "Africa/Cairo",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

// --- shared HTML fragments ---------------------------------------------------

const detailRow = (label: string, value: string) =>
  `<tr><td style="padding:6px 16px 6px 0;color:#4A5568;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:6px 0;color:#0A1A2F;font-size:15px;">${escapeHtml(value)}</td></tr>`;

const paragraph = (text: string) =>
  `<p style="margin:0 0 16px;color:#0A1A2F;font-size:15px;line-height:1.65;">${escapeHtml(text)}</p>`;

const footnoteBox = (text: string) =>
  `<div style="margin-top:28px;padding:14px 16px;border:1px solid #D1D9E0;border-radius:10px;background-color:#F8FAFC;"><p style="margin:0;color:#0A1A2F;font-size:14px;line-height:1.65;">${escapeHtml(text)}</p></div>`;

const buttonLink = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background-color:#0A1A2F;color:#F8FAFC;text-decoration:none;padding:12px 28px;border-radius:9999px;font-size:15px;">${escapeHtml(label)}</a>`;

const signoffHtml = (signoff: string) =>
  `<p style="margin:28px 0 0;color:#4A5568;font-size:14px;">${escapeHtml(signoff)}<br>Elite Eco Car Wash</p>`;

// --- owner notification --------------------------------------------------------

export function buildOwnerNotificationEmail(details: BookingDetails): {
  subject: string;
  text: string;
  html: string;
} {
  const cairoTime = formatCairoTime(details.start);
  const adminToken = process.env.ADMIN_TOKEN || "";
  const reviewLink = adminToken
    ? `${ADMIN_URL_BASE}?key=${encodeURIComponent(adminToken)}`
    : ADMIN_URL_BASE;
  const subject = `New booking request — ${details.service} · ${cairoTime}`;

  const showNotes =
    details.notes && details.notes !== "No additional notes provided";

  const text = [
    "New booking request",
    "",
    `Service:  ${details.service}`,
    `Time:     ${cairoTime} (Cairo)`,
    `Name:     ${details.attendeeName}`,
    `Email:    ${details.attendeeEmail}`,
    `Phone:    ${details.attendeePhone}`,
    ...(showNotes ? [`Notes:    ${details.notes}`] : []),
    "",
    "Confirm, decline with a note, or suggest another time here:",
    reviewLink,
  ].join("\n");

  const contentHtml = `<table style="border-collapse:collapse;width:100%;">
        ${detailRow("Service", details.service)}
        ${detailRow("Time", `${cairoTime} (Cairo)`)}
        ${detailRow("Name", details.attendeeName)}
        ${detailRow("Email", details.attendeeEmail)}
        ${detailRow("Phone", details.attendeePhone)}
        ${showNotes ? detailRow("Notes", details.notes) : ""}
      </table>
      <p style="margin:28px 0 16px;color:#0A1A2F;font-size:15px;">Confirm, decline with a note, or suggest another time here:</p>
      ${buttonLink(reviewLink, "Open booking inbox")}`;

  const html = brandedEmailHtml({
    heading: "New booking request",
    contentHtml,
    belowCardHtml: "Times shown in Cairo time (Africa/Cairo).",
  });

  return { subject, text, html };
}

// --- attendee lifecycle emails ---------------------------------------------------

interface AttendeeCopy {
  subject: string;
  heading: string;
  greeting: string;
  intro: string;
  serviceLabel: string;
  timeLabel: string;
  durationLabel: string;
  durationUnit: string;
  /** "Previous time" row label — only set for the rescheduled email. */
  oldTimeLabel: string | null;
  paragraphs: string[];
  reasonLabel: string | null;
  footnote: string | null;
  rebookLead: string | null;
  rebookButton: string | null;
  signoff: string;
}

function attendeeCopy(
  kind: AttendeeEmailKind,
  details: BookingDetails,
  lang: BookingLang
): AttendeeCopy {
  const ar = lang === "ar";
  const name = details.attendeeName;
  const base = ar
    ? {
        greeting: `مرحباً ${name}!`,
        serviceLabel: "الخدمة",
        timeLabel: "التاريخ والوقت",
        durationLabel: "المدة",
        durationUnit: "دقيقة",
        oldTimeLabel: null,
        signoff: "مع أطيب التحيات،",
      }
    : {
        greeting: `Hello ${name},`,
        serviceLabel: "Service",
        timeLabel: "Date & time",
        durationLabel: "Duration",
        durationUnit: "min",
        oldTimeLabel: null,
        signoff: "Warmly,",
      };

  if (kind === "rescheduled") {
    return ar
      ? {
          ...base,
          subject: `تم نقل موعدك — ${details.service}`,
          heading: "تم نقل موعدك",
          intro: "لقد تغيير وقت موعدك. التفاصيل الجديدة:",
          timeLabel: "الوقت الجديد",
          oldTimeLabel: "الوقت السابق",
          paragraphs: [
            "إذا تغير أي شيء، سيتواصل معك فريقنا عبر واتساب.",
          ],
          reasonLabel: null,
          footnote: null,
          rebookLead: null,
          rebookButton: null,
        }
      : {
          ...base,
          subject: `Your appointment has been moved — ${details.service}`,
          heading: "Your appointment has been moved",
          intro: "Your appointment time has changed. The new details:",
          timeLabel: "New time",
          oldTimeLabel: "Previous time",
          paragraphs: [
            "Our team will contact you via WhatsApp if anything changes.",
          ],
          reasonLabel: null,
          footnote: null,
          rebookLead: null,
          rebookButton: null,
        };
  }

  if (kind === "requested") {
    return ar
      ? {
          ...base,
          subject: `لقد استلمنا طلبك — ${details.service}`,
          heading: "لقد استلمنا طلبك",
          intro: "شكراً! لقد استلمنا طلب الحجز. التفاصيل:",
          paragraphs: [
            "يقوم فريقنا بتأكيد كل حجز شخصياً — ستصلك رسالة التأكيد قريباً.",
          ],
          reasonLabel: null,
          footnote:
            "تذكير بسياسة الحجز: يمكن إعادة جدولة أو إلغاء الحجز المؤكد حتى 24 ساعة قبل موعده — التغييرات المتأخرة أو التأخر أو عدم الحضور تخضع للرسوم كاملة.",
          rebookLead: null,
          rebookButton: null,
        }
      : {
          ...base,
          subject: `We received your booking request — ${details.service}`,
          heading: "We received your booking request",
          intro: "Thank you! Your booking request has been received. The details:",
          paragraphs: [
            "Our team confirms every booking personally — you'll receive confirmation shortly.",
          ],
          reasonLabel: null,
          footnote:
            "A reminder of our reservation policy: confirmed sessions can be rescheduled or cancelled up to 24 hours before the session — later changes, lateness or no-show are payable in full.",
          rebookLead: null,
          rebookButton: null,
        };
  }

  if (kind === "confirmed") {
    return ar
      ? {
          ...base,
          subject: `تم تأكيد موعدك — ${details.service}`,
          heading: "تم تأكيد موعدك",
          intro: "أخبار سارة — لقد تم تأكيد موعدك:",
          paragraphs: [
            "إذا تغير أي شيء، سيتواصل معك فريقنا عبر واتساب.",
          ],
          reasonLabel: null,
          footnote: null,
          rebookLead: null,
          rebookButton: null,
        }
      : {
          ...base,
          subject: `Your appointment is confirmed — ${details.service}`,
          heading: "Your appointment is confirmed",
          intro: "Good news — your appointment has been confirmed:",
          paragraphs: [
            "Our team will contact you via WhatsApp if anything changes.",
          ],
          reasonLabel: null,
          footnote: null,
          rebookLead: null,
          rebookButton: null,
        };
  }

  if (kind === "rejected") {
    return ar
      ? {
          ...base,
          subject: `بخصوص طلبك — ${details.service}`,
          heading: "بخصوص طلبك",
          intro:
            "للأسف، لم يتمكن الفريق من قبول طلب الحجز لهذا الوقت:",
          paragraphs: [],
          reasonLabel: "رسالة من الفريق",
          footnote: null,
          rebookLead:
            "يسعدنا رؤيتك في وقت آخر — اختر موعداً جديداً هنا:",
          rebookButton: "اختر وقتاً آخر",
        }
      : {
          ...base,
          subject: `About your booking request — ${details.service}`,
          heading: "About your booking request",
          intro:
            "Unfortunately, we couldn't accept your booking request for this time:",
          paragraphs: [],
          reasonLabel: "A note from the team",
          footnote: null,
          rebookLead:
            "We'd love to welcome you another time — pick a new slot here:",
          rebookButton: "Book another time",
        };
  }

  // cancelled
  return ar
    ? {
        ...base,
        subject: `بخصوص حجزك — ${details.service}`,
        heading: "بخصوص حجزك",
        intro: "لقد تم إلغاء حجزك:",
        paragraphs: [],
        reasonLabel: "السبب",
        footnote: null,
        rebookLead:
          "يسعدنا رؤيتك في وقت آخر — اختر موعداً جديداً هنا:",
        rebookButton: "احجز مرة أخرى",
      }
    : {
        ...base,
        subject: `About your booking — ${details.service}`,
        heading: "About your booking",
        intro: "Your booking has been cancelled:",
        paragraphs: [],
        reasonLabel: "Reason",
        footnote: null,
        rebookLead:
          "We'd love to welcome you another time — pick a new slot here:",
        rebookButton: "Book again",
      };
}

export function buildAttendeeEmail(
  kind: AttendeeEmailKind,
  details: BookingDetails
): { subject: string; text: string; html: string } {
  const lang: BookingLang = details.lang ?? "en";
  const ar = lang === "ar";
  const t = attendeeCopy(kind, details, lang);
  const cairoTime = formatCairoTime(details.start, lang);
  const cairoSuffix = ar ? " (القاهرة)" : " (Cairo)";
  const duration =
    details.durationMinutes && details.durationMinutes > 0
      ? `${details.durationMinutes} ${t.durationUnit}`
      : null;
  const reason = details.reason.trim();
  const rebookUrl = ar ? `${BOOK_URL}?lang=ar` : BOOK_URL;
  // Previous time row — rescheduled emails only, and only when the old start
  // is actually known (payload field or Cal API backfill).
  const oldCairoTime =
    t.oldTimeLabel && details.oldStart
      ? formatCairoTime(details.oldStart, lang)
      : null;

  const text = [
    t.greeting,
    "",
    t.intro,
    "",
    `${t.serviceLabel}: ${details.service}`,
    ...(t.oldTimeLabel && oldCairoTime
      ? [`${t.oldTimeLabel}: ${oldCairoTime}${cairoSuffix}`]
      : []),
    `${t.timeLabel}: ${cairoTime}${cairoSuffix}`,
    ...(duration ? [`${t.durationLabel}: ${duration}`] : []),
    ...(t.reasonLabel && reason ? ["", `${t.reasonLabel}: ${reason}`] : []),
    ...(t.paragraphs.length ? ["", ...t.paragraphs] : []),
    ...(t.rebookLead ? ["", t.rebookLead, rebookUrl] : []),
    ...(t.footnote ? ["", t.footnote] : []),
    "",
    t.signoff,
    "Elite Eco Car Wash",
  ].join("\n");

  const contentHtml = `${paragraph(t.greeting)}${paragraph(t.intro)}<table style="border-collapse:collapse;width:100%;margin-bottom:8px;">
        ${detailRow(t.serviceLabel, details.service)}
        ${
          t.oldTimeLabel && oldCairoTime
            ? `<tr><td style="padding:6px 16px 6px 0;color:#4A5568;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;white-space:nowrap;vertical-align:top;">${escapeHtml(t.oldTimeLabel)}</td><td style="padding:6px 0;color:#4A5568;font-size:15px;text-decoration:line-through;">${escapeHtml(`${oldCairoTime}${cairoSuffix}`)}</td></tr>`
            : ""
        }
        ${detailRow(t.timeLabel, `${cairoTime}${cairoSuffix}`)}
        ${duration ? detailRow(t.durationLabel, duration) : ""}
        ${t.reasonLabel && reason ? detailRow(t.reasonLabel, reason) : ""}
      </table>
      ${t.paragraphs.map((p) => paragraph(p)).join("")}${
        t.rebookLead && t.rebookButton
          ? `<p style="margin:12px 0 16px;color:#0A1A2F;font-size:15px;line-height:1.65;">${escapeHtml(t.rebookLead)}</p>${buttonLink(rebookUrl, t.rebookButton)}`
          : ""
      }${t.footnote ? footnoteBox(t.footnote) : ""}
      ${signoffHtml(t.signoff)}`;

  const html = brandedEmailHtml({
    heading: t.heading,
    contentHtml,
    belowCardHtml: ar
      ? "الأوقات بتوقيت القاهرة (Africa/Cairo)."
      : "Times shown in Cairo time (Africa/Cairo).",
  });

  return { subject: t.subject, text, html };
}

// --- senders (never throw) -------------------------------------------------------

async function postResend(body: Record<string, unknown>): Promise<Response> {
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function sendOwnerNotificationEmail(
  details: BookingDetails
): Promise<{ sent: boolean; reason?: string }> {
  const { subject, text, html } = buildOwnerNotificationEmail(details);
  const apiKey = process.env.RESEND_API_KEY;
  const to = (process.env.NOTIFY_EMAIL || NOTIFY_EMAIL_DEFAULT)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!apiKey) {
    // Graceful no-op: never break the webhook because email isn't configured.
    console.log(
      `[cal-webhook] RESEND_API_KEY not set — would email ${to}:\nSubject: ${subject}\n${text}`
    );
    return { sent: false, reason: "email-not-configured" };
  }

  try {
    const res = await postResend({ from: OWNER_EMAIL_FROM, to, subject, text, html });
    if (!res.ok) {
      const body = await res.text();
      console.error(
        `[cal-webhook] Resend send failed (${res.status}): ${body.slice(0, 300)}`
      );
      return { sent: false, reason: `resend-${res.status}` };
    }
    console.log(`[cal-webhook] Notification email sent to ${to}: ${subject}`);
    return { sent: true };
  } catch (error) {
    console.error("[cal-webhook] Resend request error:", error);
    return { sent: false, reason: "resend-network-error" };
  }
}

export async function sendAttendeeEmail(
  kind: AttendeeEmailKind,
  details: BookingDetails
): Promise<{ sent: boolean; reason?: string }> {
  const to = details.attendeeEmail;
  if (!to || !to.includes("@")) {
    console.warn(
      `[cal-webhook] No attendee email on booking uid=${details.uid} — skipping ${kind} email`
    );
    return { sent: false, reason: "no-attendee-email" };
  }

  const { subject, text, html } = buildAttendeeEmail(kind, details);
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    // Graceful no-op: never break the webhook because email isn't configured.
    console.log(
      `[cal-webhook] RESEND_API_KEY not set — would email attendee ${to} (${kind}, lang=${details.lang ?? "en"}):\nSubject: ${subject}\n${text}`
    );
    return { sent: false, reason: "email-not-configured" };
  }

  try {
    const res = await postResend({
      from: ATTENDEE_EMAIL_FROM,
      to: [to],
      reply_to: ATTENDEE_REPLY_TO,
      subject,
      text,
      html,
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(
        `[cal-webhook] Attendee ${kind} email to ${to} failed (${res.status}): ${body.slice(0, 300)}`
      );
      return { sent: false, reason: `resend-${res.status}` };
    }
    console.log(
      `[cal-webhook] Attendee ${kind} email sent to ${to} (lang=${details.lang ?? "en"}): ${subject}`
    );
    return { sent: true };
  } catch (error) {
    console.error(`[cal-webhook] Attendee ${kind} email request error:`, error);
    return { sent: false, reason: "resend-network-error" };
  }
}