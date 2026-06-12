import { formatEgp, formatRub } from "./shop-products";
import { brandedEmailHtml, escapeHtml } from "./branded-email";

/**
 * Email builders for /api/order — the owner notification to Victoria and the
 * buyer confirmation. Pure functions (no env, no fetch) so they can be
 * rendered and inspected outside the route; the route owns sending.
 *
 * Both HTML bodies use the shared branded shell (dark logo band header) —
 * Victoria wants the brand on every email, her own notifications included.
 * Text parts stay plain.
 */

export interface OrderEmailLine {
  nameEn: string;
  nameRu: string;
  qty: number;
  lineEgp: number;
  lineRub: number;
}

export interface OrderEmailInput {
  orderNumber: string;
  name: string;
  phone: string;
  /** "" when the buyer left it blank. */
  email: string;
  address: string;
  /** "" when empty. */
  note: string;
  lang: "en" | "ru";
  lines: OrderEmailLine[];
  totalEgp: number;
  totalRub: number;
}

const detailRow = (label: string, value: string) =>
  `<tr><td style="padding:6px 16px 6px 0;color:#847866;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:6px 0;color:#3A332C;font-size:15px;">${escapeHtml(value)}</td></tr>`;

function itemsTableHtml(
  order: OrderEmailInput,
  labels: { product: string; qty: string; lineTotal: string; total: string },
  productCell: (line: OrderEmailLine) => string
): string {
  const itemRows = order.lines
    .map(
      (l) =>
        `<tr>` +
        `<td style="padding:8px 12px 8px 0;color:#3A332C;font-size:14px;border-bottom:1px solid #E5DCCB;">${productCell(l)}</td>` +
        `<td style="padding:8px 12px;color:#3A332C;font-size:14px;border-bottom:1px solid #E5DCCB;text-align:center;">${l.qty}</td>` +
        `<td style="padding:8px 0;color:#3A332C;font-size:14px;border-bottom:1px solid #E5DCCB;text-align:right;white-space:nowrap;">${escapeHtml(formatEgp(l.lineEgp))}<br><span style="color:#847866;font-size:13px;">${escapeHtml(formatRub(l.lineRub))}</span></td>` +
        `</tr>`
    )
    .join("");

  return `<table style="border-collapse:collapse;width:100%;">
        <tr>
          <th style="padding:0 12px 8px 0;color:#847866;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;text-align:left;">${escapeHtml(labels.product)}</th>
          <th style="padding:0 12px 8px;color:#847866;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;text-align:center;">${escapeHtml(labels.qty)}</th>
          <th style="padding:0 0 8px;color:#847866;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;text-align:right;">${escapeHtml(labels.lineTotal)}</th>
        </tr>
        ${itemRows}
        <tr>
          <td colspan="2" style="padding:12px 12px 0 0;color:#3A332C;font-size:15px;font-weight:bold;">${escapeHtml(labels.total)}</td>
          <td style="padding:12px 0 0;color:#3A332C;font-size:15px;font-weight:bold;text-align:right;white-space:nowrap;">${escapeHtml(formatEgp(order.totalEgp))}<br><span style="font-weight:normal;color:#847866;font-size:13px;">${escapeHtml(formatRub(order.totalRub))}</span></td>
        </tr>
      </table>`;
}

// --- owner notification ----------------------------------------------------------

export function buildOwnerOrderEmail(order: OrderEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `New shop order ${order.orderNumber} — ${order.name} · ${order.totalEgp} EGP (COD)`;

  const textItems = order.lines.map(
    (l) =>
      `- ${l.nameEn} / ${l.nameRu} × ${l.qty} = ${formatEgp(l.lineEgp)} / ${formatRub(l.lineRub)}`
  );
  const text = [
    "New shop order (cash on delivery)",
    "",
    `Order number: ${order.orderNumber}`,
    "",
    "Items:",
    ...textItems,
    "",
    `Total:    ${formatEgp(order.totalEgp)} / ${formatRub(order.totalRub)}`,
    "",
    `Name:     ${order.name}`,
    `Phone:    ${order.phone}`,
    `Email:    ${order.email || "—"}`,
    `Address:  ${order.address}`,
    `Note:     ${order.note || "—"}`,
    `Language: ${order.lang}`,
    "",
    "Cash on delivery — contact the client on WhatsApp to confirm delivery time.",
  ].join("\n");

  const contentHtml = `<p style="margin:0 0 24px;color:#3A332C;font-size:16px;font-weight:bold;">Order number: ${escapeHtml(order.orderNumber)}</p>
      ${itemsTableHtml(
        order,
        { product: "Product", qty: "Qty", lineTotal: "Line total", total: "Total" },
        (l) =>
          `${escapeHtml(l.nameEn)}<br><span style="color:#847866;font-size:13px;">${escapeHtml(l.nameRu)}</span>`
      )}
      <table style="border-collapse:collapse;width:100%;margin-top:24px;">
        ${detailRow("Name", order.name)}
        ${detailRow("Phone", order.phone)}
        ${detailRow("Email", order.email || "—")}
        ${detailRow("Address", order.address)}
        ${detailRow("Note", order.note || "—")}
        ${detailRow("Language", order.lang)}
      </table>
      <p style="margin:28px 0 0;color:#3A332C;font-size:15px;">Cash on delivery — contact the client on WhatsApp to confirm delivery time.</p>`;

  const html = brandedEmailHtml({ heading: "New shop order", contentHtml });

  return { subject, text, html };
}

// --- buyer confirmation ------------------------------------------------------------

export function buildBuyerOrderEmail(order: OrderEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const ru = order.lang === "ru";
  const subject = ru
    ? `Ваш заказ ${order.orderNumber} — Victoria Vasilyeva Holistic Beauty`
    : `Your order ${order.orderNumber} — Victoria Vasilyeva Holistic Beauty`;

  const t = ru
    ? {
        greeting: `Здравствуйте, ${order.name}!`,
        orderNumber: `Номер заказа: ${order.orderNumber}`,
        thanks:
          "Спасибо за ваш заказ в Victoria Vasilyeva Holistic Beauty. Вот его детали:",
        heading: "Ваш заказ",
        product: "Товар",
        qty: "Кол-во",
        lineTotal: "Сумма",
        total: "Итого",
        cod: "Оплата при получении (наличными).",
        call: "Наша команда свяжется с вами в WhatsApp, чтобы подтвердить время доставки.",
        delivery: "Доставка по Египту в течение 24–72 часов.",
        signoff: "С теплом,",
      }
    : {
        greeting: `Hello ${order.name},`,
        orderNumber: `Order number: ${order.orderNumber}`,
        thanks:
          "Thank you for your order with Victoria Vasilyeva Holistic Beauty. Here are the details:",
        heading: "Your order",
        product: "Product",
        qty: "Qty",
        lineTotal: "Line total",
        total: "Total",
        cod: "Payment: cash on delivery.",
        call: "Our team will get in touch via WhatsApp to confirm your delivery time.",
        delivery: "Delivery within 24–72 hours across Egypt.",
        signoff: "Warmly,",
      };

  const productName = (l: OrderEmailLine) => (ru ? l.nameRu : l.nameEn);

  const textItems = order.lines.map(
    (l) =>
      `- ${productName(l)} × ${l.qty} = ${formatEgp(l.lineEgp)} / ${formatRub(l.lineRub)}`
  );
  const text = [
    t.greeting,
    "",
    t.orderNumber,
    "",
    t.thanks,
    "",
    ...textItems,
    "",
    `${t.total}: ${formatEgp(order.totalEgp)} / ${formatRub(order.totalRub)}`,
    "",
    t.cod,
    t.call,
    t.delivery,
    "",
    t.signoff,
    "Victoria Vasilyeva Holistic Beauty",
  ].join("\n");

  const contentHtml = `<p style="margin:0 0 8px;color:#3A332C;font-size:15px;">${escapeHtml(t.greeting)}</p>
      <p style="margin:0 0 16px;color:#3A332C;font-size:16px;font-weight:bold;">${escapeHtml(t.orderNumber)}</p>
      <p style="margin:0 0 24px;color:#3A332C;font-size:15px;">${escapeHtml(t.thanks)}</p>
      ${itemsTableHtml(
        order,
        { product: t.product, qty: t.qty, lineTotal: t.lineTotal, total: t.total },
        (l) => escapeHtml(productName(l))
      )}
      <div style="margin-top:28px;padding:14px 16px;border:1px solid #E5DCCB;border-radius:10px;background-color:#F4EFE7;">
        <p style="margin:0;color:#3A332C;font-size:14px;line-height:1.65;">${escapeHtml(t.cod)}<br>${escapeHtml(t.call)}<br>${escapeHtml(t.delivery)}</p>
      </div>
      <p style="margin:28px 0 0;color:#847866;font-size:14px;">${escapeHtml(t.signoff)}<br>Victoria Vasilyeva Holistic Beauty</p>`;

  const html = brandedEmailHtml({ heading: t.heading, contentHtml });

  return { subject, text, html };
}
