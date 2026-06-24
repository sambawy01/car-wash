import { formatEgp } from "./catalog";
import { brandedEmailHtml, escapeHtml } from "./branded-email";
import type {
  CancelReason,
  CancelReasonCode,
  StoredOrder,
  StoredOrderItem,
} from "./orders";
/**
 * Client-facing status emails for shop orders
 * (confirmed / shipped / delivered / cancelled).
 *
 * Mirrors the buyer-confirmation email in /api/order: same dark logo band
 * header, same blue/silver palette, same Resend REST pattern. Lang-aware (en/ar)
 * from the order's stored `lang`. Sent from bookings@ with reply-to
 * info@ so replies land in the owner's inbox.
 *
 * Cancellation emails include the reason: known reason codes get a localized
 * label; free text ("other" or an extra note) is passed through verbatim.
 *
 * Failure model: `sendOrderStatusEmail` never throws — a mail failure must
 * never roll back or fail the status update. Callers get { sent, reason? }.
 */

const EMAIL_FROM =
  "Elite Eco Car Wash <bookings@eliteecocarwash.com>";
const REPLY_TO = "info@eliteecocarwash.com";
const CONTACT_EMAIL = "info@eliteecocarwash.com";

export type EmailStatus = "confirmed" | "shipped" | "delivered" | "cancelled";

/** Localized labels for the known cancellation reason codes. */
const CANCEL_REASON_LABELS: Record<
  Exclude<CancelReasonCode, "other">,
  { en: string; ar: string }
> = {
  "out-of-stock": { en: "Out of stock", ar: "المنتج غير متوفر" },
  unreachable: {
    en: "Could not reach the client",
    ar: "تعذر الاتصال بالعميل",
  },
  "client-request": {
    en: "Cancelled at client's request",
    ar: "تم الإلغاء بناءً على طلب العميل",
  },
  "delivery-area": {
    en: "Delivery area not covered",
    ar: "منطقة التوصيل غير مشمولة",
  },
};

/** "Label — free text" in the order's language; free text verbatim. */
function cancelReasonText(reason: CancelReason | undefined, ar: boolean): string {
  if (!reason) return ar ? "غير محدد" : "not specified";
  if (reason.code === "other") {
    return reason.note || (ar ? "غير محدد" : "not specified");
  }
  const label = CANCEL_REASON_LABELS[reason.code];
  const base = ar ? label.ar : label.en;
  return reason.note ? `${base} — ${reason.note}` : base;
}

interface StatusCopy {
  subject: string;
  heading: string;
  greeting: string;
  paragraphs: string[];
  recapTitle: string;
  product: string;
  qty: string;
  lineTotal: string;
  total: string;
  footnote: string | null;
  signoff: string;
}

function copyFor(
  order: StoredOrder,
  status: EmailStatus,
  cancelReason?: CancelReason
): StatusCopy {
  const ar = order.lang === "ar";
  const n = order.orderNumber;

  if (status === "confirmed") {
    return ar
      ? {
          subject: `تم تأكيد طلبك ${n}`,
          heading: "تم تأكيد الطلب",
          greeting: `مرحباً ${order.name}!`,
          paragraphs: [
            `أخبار سارة — تم تأكيد طلبك ${n}. سيتواصل معك فريقنا عبر واتساب لتأكيد موعد التوصيل. الدفع عند الاستلام (نقداً).`,
          ],
          recapTitle: "تفاصيل الطلب",
          product: "المنتج",
          qty: "الكمية",
          lineTotal: "السعر",
          total: "الإجمالي",
          footnote: "التوصيل خلال 24–72 ساعة في جميع أنحاء مصر.",
          signoff: "مع أطيب التحيات،",
        }
      : {
          subject: `Your order ${n} is confirmed`,
          heading: "Your order is confirmed",
          greeting: `Hello ${order.name},`,
          paragraphs: [
            `Good news — your order ${n} is confirmed. Our team will contact you via WhatsApp to confirm the delivery time. Payment cash on delivery.`,
          ],
          recapTitle: "Order recap",
          product: "Product",
          qty: "Qty",
          lineTotal: "Line total",
          total: "Total",
          footnote: "Delivery within 24–72 hours across Egypt.",
          signoff: "Warmly,",
        };
  }

  if (status === "cancelled") {
    const reasonText = cancelReasonText(cancelReason, ar);
    return ar
      ? {
          subject: `تم إلغاء طلبك ${n}`,
          heading: "تم إلغاء الطلب",
          greeting: `مرحباً ${order.name}!`,
          paragraphs: [
            `للأسف، تم إلغاء طلبك ${n}.`,
            `السبب: ${reasonText}.`,
            `إذا كان هذا غير متوقع، اكتب لنا على ${CONTACT_EMAIL} أو اسأل Eco على موقعنا.`,
          ],
          recapTitle: "تفاصيل الطلب",
          product: "المنتج",
          qty: "الكمية",
          lineTotal: "السعر",
          total: "الإجمالي",
          footnote: null,
          signoff: "مع أطيب التحيات،",
        }
      : {
          subject: `Your order ${n} has been cancelled`,
          heading: "Your order has been cancelled",
          greeting: `Hello ${order.name},`,
          paragraphs: [
            `We're sorry — your order ${n} has been cancelled.`,
            `Reason: ${reasonText}.`,
            `If this is unexpected, write to ${CONTACT_EMAIL} or ask Eco on our site.`,
          ],
          recapTitle: "Order recap",
          product: "Product",
          qty: "Qty",
          lineTotal: "Line total",
          total: "Total",
          footnote: null,
          signoff: "Warmly,",
        };
  }

  if (status === "shipped") {
    return ar
      ? {
          subject: `طلبك ${n} في الطريق`,
          heading: "تم شحن الطلب",
          greeting: `مرحباً ${order.name}!`,
          paragraphs: [
            `أخبار سارة — تم شحن طلبك ${n}. سيتواصل معك فريقنا عبر واتساب لتأكيد موعد التوصيل. الدفع عند الاستلام (نقداً).`,
          ],
          recapTitle: "تفاصيل الطلب",
          product: "المنتج",
          qty: "الكمية",
          lineTotal: "السعر",
          total: "الإجمالي",
          footnote: "التوصيل خلال 24–72 ساعة في جميع أنحاء مصر.",
          signoff: "مع أطيب التحيات،",
        }
      : {
          subject: `Your order ${n} is on its way`,
          heading: "Your order has shipped",
          greeting: `Hello ${order.name},`,
          paragraphs: [
            `Good news — your order ${n} has been shipped. Our team will contact you via WhatsApp to confirm the delivery time. Payment cash on delivery.`,
          ],
          recapTitle: "Order recap",
          product: "Product",
          qty: "Qty",
          lineTotal: "Line total",
          total: "Total",
          footnote: "Delivery within 24–72 hours across Egypt.",
          signoff: "Warmly,",
        };
  }

  return ar
    ? {
        subject: `تم توصيل طلبك ${n}`,
        heading: "تم توصيل الطلب",
        greeting: `مرحباً ${order.name}!`,
        paragraphs: [
          `شكراً لطلبك ${n} من Elite Eco Car Wash!`,
          "نأمل أن تستمتع بمنتجاتك. للحصول على نصائح حول استخدامها، اسأل Eco على موقعنا أو راسلنا.",
        ],
        recapTitle: "تفاصيل الطلب",
        product: "المنتج",
        qty: "الكمية",
        lineTotal: "السعر",
        total: "الإجمالي",
        footnote: null,
        signoff: "مع أطيب التحيات،",
      }
    : {
        subject: `Your order ${n} has been delivered`,
        heading: "Your order has been delivered",
        greeting: `Hello ${order.name},`,
        paragraphs: [
          `Thank you for your order ${n} with Elite Eco Car Wash!`,
          "We hope you love your products. For advice on using them, ask Eco on our website or write to us.",
        ],
        recapTitle: "Order recap",
        product: "Product",
        qty: "Qty",
        lineTotal: "Line total",
        total: "Total",
        footnote: null,
        signoff: "Warmly,",
      };
}

export function buildOrderStatusEmail(
  order: StoredOrder,
  status: EmailStatus,
  cancelReason?: CancelReason
): { subject: string; text: string; html: string } {
  const t = copyFor(order, status, cancelReason);
  const ar = order.lang === "ar";
  const itemName = (item: StoredOrderItem) =>
    ar ? item.names.ar : item.names.en;

  const textItems = order.items.map(
    (item) =>
      `- ${itemName(item)} × ${item.qty} = ${formatEgp(item.lineTotals.egp)}`
  );
  const text = [
    t.greeting,
    "",
    ...t.paragraphs,
    "",
    `${t.recapTitle}:`,
    ...textItems,
    "",
    `${t.total}: ${formatEgp(order.totals.egp)}`,
    ...(t.footnote ? ["", t.footnote] : []),
    "",
    t.signoff,
    "Elite Eco Car Wash",
  ].join("\n");

  const itemRows = order.items
    .map(
      (item) =>
        `<tr>` +
        `<td style="padding:8px 12px 8px 0;color:#0A1A2F;font-size:14px;border-bottom:1px solid #D1D9E0;">${escapeHtml(itemName(item))}</td>` +
        `<td style="padding:8px 12px;color:#0A1A2F;font-size:14px;border-bottom:1px solid #D1D9E0;text-align:center;">${item.qty}</td>` +
        `<td style="padding:8px 0;color:#0A1A2F;font-size:14px;border-bottom:1px solid #D1D9E0;text-align:right;white-space:nowrap;">${escapeHtml(formatEgp(item.lineTotals.egp))}</td>` +
        `</tr>`
    )
    .join("");

  const paragraphsHtml = t.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;color:#0A1A2F;font-size:15px;line-height:1.65;">${escapeHtml(p)}</p>`
    )
    .join("");

  const contentHtml = `<p style="margin:0 0 8px;color:#0A1A2F;font-size:15px;">${escapeHtml(t.greeting)}</p>
      ${paragraphsHtml}
      <table style="border-collapse:collapse;width:100%;margin-top:8px;">
        <tr>
          <th style="padding:0 12px 8px 0;color:#4A5568;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;text-align:left;">${escapeHtml(t.product)}</th>
          <th style="padding:0 12px 8px;color:#4A5568;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;text-align:center;">${escapeHtml(t.qty)}</th>
          <th style="padding:0 0 8px;color:#4A5568;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;text-align:right;">${escapeHtml(t.lineTotal)}</th>
        </tr>
        ${itemRows}
        <tr>
          <td colspan="2" style="padding:12px 12px 0 0;color:#0A1A2F;font-size:15px;font-weight:bold;">${escapeHtml(t.total)}</td>
          <td style="padding:12px 0 0;color:#0A1A2F;font-size:15px;font-weight:bold;text-align:right;white-space:nowrap;">${escapeHtml(formatEgp(order.totals.egp))}</td>
        </tr>
      </table>
      ${
        t.footnote
          ? `<div style="margin-top:28px;padding:14px 16px;border:1px solid #D1D9E0;border-radius:10px;background-color:#F8FAFC;"><p style="margin:0;color:#0A1A2F;font-size:14px;line-height:1.65;">${escapeHtml(t.footnote)}</p></div>`
          : ""
      }
      <p style="margin:28px 0 0;color:#4A5568;font-size:14px;">${escapeHtml(t.signoff)}<br>Elite Eco Car Wash</p>`;

  const html = brandedEmailHtml({ heading: t.heading, contentHtml });

  return { subject: t.subject, text, html };
}

/**
 * Send the status email to the order's buyer. Never throws.
 * Returns { sent: false, reason: "no-buyer-email" } for phone-only orders.
 */
export async function sendOrderStatusEmail(
  order: StoredOrder,
  status: EmailStatus,
  cancelReason?: CancelReason
): Promise<{ sent: boolean; reason?: string }> {
  if (!order.email) {
    return { sent: false, reason: "no-buyer-email" };
  }

  const { subject, text, html } = buildOrderStatusEmail(
    order,
    status,
    cancelReason
  );
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    // Graceful no-op: never block status updates because email isn't configured.
    console.log(
      `[orders] RESEND_API_KEY not set — would email ${order.email}:\nSubject: ${subject}\n${text}`
    );
    return { sent: false, reason: "email-not-configured" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [order.email],
        reply_to: REPLY_TO,
        subject,
        text,
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(
        `[orders] Status email (${status}) to ${order.email} failed (${res.status}): ${body.slice(0, 300)}`
      );
      return { sent: false, reason: `resend-${res.status}` };
    }
    console.log(
      `[orders] Status email (${status}) sent to ${order.email}: ${subject}`
    );
    return { sent: true };
  } catch (error) {
    console.error(`[orders] Status email (${status}) request error:`, error);
    return { sent: false, reason: "resend-network-error" };
  }
}