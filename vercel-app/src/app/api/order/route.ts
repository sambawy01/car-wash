import { NextRequest, NextResponse } from "next/server";
import { corsHeaders, isAllowedOrigin } from "@/lib/cors";
import { saveOrder, type StoredOrder } from "@/lib/orders";
import {
  getCatalog,
  effectiveSoldOut,
  decrementQuantities,
  type Product,
} from "@/lib/catalog";
import {
  buildBuyerOrderEmail,
  buildOwnerOrderEmail,
  type OrderEmailInput,
} from "@/lib/order-emails";
import {
  notifyNewOrder,
  notifyStockChanges,
  type StockChange,
} from "@/lib/assistant/notify";

export const runtime = "nodejs";

/**
 * POST /api/order — cash-on-delivery product orders from the static shop.
 *
 * Trust model:
 * - The catalog (names + prices + stock) is the DYNAMIC catalog in
 *   @/lib/catalog (Vercel Blob, falling back to its built-in seed). Totals
 *   are always computed here; any client-supplied totals are ignored.
 * - Sold-out products (manual flag or quantity 0) and quantities exceeding
 *   tracked stock are rejected with a 400 whose `fields.items` message is
 *   bilingual (EN / RU) so the static shop can show it verbatim.
 * - On success, tracked quantities are decremented (read-modify-write;
 *   races are tolerable at this volume). Hitting 0 makes the product auto
 *   sold-out for subsequent catalog fetches.
 * - Same CORS allowlist as /api/chat; per-IP in-memory rate limit.
 * - Owner notification via Resend (same pattern as /api/cal/webhook), with a
 *   graceful console-log no-op when RESEND_API_KEY is unset. A mailer failure
 *   never 500s the order — the client still gets { received: true }.
 * - Optional buyer `email`: when present, a second confirmation email is sent
 *   to the buyer. Buyer-email failures never affect the response success or
 *   the team's notification — both outcomes are reported separately in
 *   { received, orderNumber, emailed, ownerEmails, buyerEmailed }.
 * - Every order gets a server-generated order number (VV-XXXXXX) included in
 *   the response and in both emails so it can be quoted over the phone.
 * - Owner notifications go out as one Resend call PER recipient so a single
 *   bounced inbox can't take down the other; `emailed` stays true when at
 *   least one recipient succeeded, with per-recipient counts in
 *   `ownerEmails: { sent, failed }`.
 * - Every order is persisted to Vercel Blob (private store) at
 *   `orders/<orderNumber>.json` so /admin can track its status
 *   (ordered → shipped → delivered). A Blob failure must NEVER fail the
 *   order — it is caught and logged, and the response reports
 *   `stored: boolean`.
 */

const NOTIFY_EMAIL_DEFAULT = "info@eliteecocarwash.com";
const EMAIL_FROM =
  "the team Holistic Beauty <orders@eliteecocarwash.com>";
const BUYER_EMAIL_FROM =
  "Elite Eco Car Wash <bookings@eliteecocarwash.com>";
const BUYER_REPLY_TO = "info@eliteecocarwash.com";

const MAX_DISTINCT_ITEMS = 8;
const MAX_QTY = 10;
const PHONE_RE = /^\+?[0-9\s\-()]{8,17}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 120;

// --- CORS preflight --------------------------------------------------------

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

// --- Rate limiting -----------------------------------------------------------
// Simple in-memory per-IP sliding window (mirrors /api/chat). Per-instance,
// best-effort only — on serverless each instance keeps its own counters.

const RATE_LIMIT = 5; // requests
const RATE_WINDOW_MS = 60_000; // per minute
const hits = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_WINDOW_MS;
  const recent = (hits.get(ip) ?? []).filter((t) => t > windowStart);
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  // Opportunistic cleanup so the map doesn't grow unbounded.
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((t) => t <= windowStart)) hits.delete(key);
    }
  }
  return false;
}

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "unknown";
}

// --- Validation --------------------------------------------------------------

interface OrderLine {
  product: Product;
  qty: number;
  lineEgp: number;
}

interface ValidatedOrder {
  lines: OrderLine[];
  totalEgp: number;
  name: string;
  phone: string; // normalized (spaces/dashes/parens stripped)
  email: string; // optional — "" when the buyer left it blank
  address: string;
  note: string;
  lang: "en" | "ar";
}

function validateOrder(
  body: unknown,
  catalog: Product[]
): { ok: true; order: ValidatedOrder } | { ok: false; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  // Only active products are orderable — hidden products behave like unknown
  // slugs, exactly as the public /api/products presents the world.
  const productsBySlug = new Map(
    catalog.filter((p) => p.active).map((p) => [p.slug, p])
  );

  // items -------------------------------------------------------------------
  const lines: OrderLine[] = [];
  if (!Array.isArray(b.items) || b.items.length === 0) {
    fields.items = "items must be a non-empty array";
  } else if (b.items.length > MAX_DISTINCT_ITEMS) {
    fields.items = `items must contain at most ${MAX_DISTINCT_ITEMS} distinct products`;
  } else {
    const seen = new Set<string>();
    for (const [i, raw] of b.items.entries()) {
      const item = (raw ?? {}) as { slug?: unknown; qty?: unknown };
      if (typeof item.slug !== "string" || !productsBySlug.has(item.slug)) {
        fields.items = `items[${i}].slug is not a known product`;
        break;
      }
      if (seen.has(item.slug)) {
        fields.items = `items[${i}].slug is a duplicate — merge quantities per product`;
        break;
      }
      if (
        typeof item.qty !== "number" ||
        !Number.isInteger(item.qty) ||
        item.qty < 1 ||
        item.qty > MAX_QTY
      ) {
        fields.items = `items[${i}].qty must be an integer between 1 and ${MAX_QTY}`;
        break;
      }
      const product = productsBySlug.get(item.slug)!;
      // Stock checks — bilingual messages the static shop shows verbatim.
      if (effectiveSoldOut(product)) {
        fields.items = `“${product.en.name}” is sold out / «${product.ar.name}» غير متوفر`;
        break;
      }
      if (typeof product.quantity === "number" && item.qty > product.quantity) {
        fields.items = `Only ${product.quantity} left of “${product.en.name}” / Осталось только ${product.quantity}: «${product.ar.name}»`;
        break;
      }
      seen.add(item.slug);
      lines.push({
        product,
        qty: item.qty,
        lineEgp: product.priceEgp * item.qty,
              });
    }
  }

  // name ----------------------------------------------------------------------
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (name.length < 2 || name.length > 80) {
    fields.name = "name must be 2-80 characters";
  }

  // phone — validate the raw shape, then normalize like the booking route
  // (strip spaces/dashes/parens) for storage in the notification email.
  const rawPhone = typeof b.phone === "string" ? b.phone.trim() : "";
  const normalizedPhone = rawPhone.replace(/[\s\-()]/g, "");
  if (!PHONE_RE.test(rawPhone) || !/^\+?[0-9]{8,17}$/.test(normalizedPhone)) {
    fields.phone = "phone must be 8-17 digits, optionally starting with +";
  }

  // email (optional) ------------------------------------------------------------
  let email = "";
  if (b.email !== undefined && b.email !== null && b.email !== "") {
    if (
      typeof b.email !== "string" ||
      b.email.trim().length > MAX_EMAIL_LEN ||
      !EMAIL_RE.test(b.email.trim())
    ) {
      fields.email = `email must be a valid address of at most ${MAX_EMAIL_LEN} characters`;
    } else {
      email = b.email.trim();
    }
  }

  // address -------------------------------------------------------------------
  const address = typeof b.address === "string" ? b.address.trim() : "";
  if (address.length < 5 || address.length > 400) {
    fields.address = "address must be 5-400 characters";
  }

  // note (optional) -----------------------------------------------------------
  let note = "";
  if (b.note !== undefined && b.note !== null) {
    if (typeof b.note !== "string" || b.note.length > 500) {
      fields.note = "note must be a string of at most 500 characters";
    } else {
      note = b.note.trim();
    }
  }

  // lang ----------------------------------------------------------------------
  if (b.lang !== "en" && b.lang !== "ar") {
    fields.lang = "lang must be 'en' or 'ar'";
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    order: {
      lines,
      totalEgp: lines.reduce((sum, l) => sum + l.lineEgp, 0),
      name,
      phone: normalizedPhone,
      email,
      address,
      note,
      lang: b.lang as "en" | "ar",
    },
  };
}

// --- Order number ----------------------------------------------------------------

/**
 * Human-readable order number: `VV-` + 6 uppercase base36 chars.
 * Last 4 base36 digits of the ms timestamp (cycles ~28 min) + 2 random
 * base36 chars — collisions are vanishingly unlikely at this shop's volume,
 * and the result is short enough to read over the phone.
 */
function generateOrderNumber(): string {
  const ts = Date.now().toString(36).slice(-4);
  const rand = Math.floor(Math.random() * 36 * 36)
    .toString(36)
    .padStart(2, "0");
  return `VV-${(ts + rand).toUpperCase()}`;
}

// --- Notification email --------------------------------------------------------

/** Adapt the validated order to the pure email builders in @/lib/order-emails. */
function toOrderEmailInput(
  order: ValidatedOrder,
  orderNumber: string
): OrderEmailInput {
  return {
    orderNumber,
    name: order.name,
    phone: order.phone,
    email: order.email,
    address: order.address,
    note: order.note,
    lang: order.lang,
    lines: order.lines.map((l) => ({
      nameEn: l.product.en.name,
      nameAr: l.product.ar.name,
      qty: l.qty,
      lineEgp: l.lineEgp,
    })),
    totalEgp: order.totalEgp,
  };
}

async function sendNotificationEmail(
  order: ValidatedOrder,
  orderNumber: string
): Promise<{ sent: boolean; sentCount: number; failedCount: number; reason?: string }> {
  const { subject, text, html } = buildOwnerOrderEmail(
    toOrderEmailInput(order, orderNumber)
  );
  const apiKey = process.env.RESEND_API_KEY;
  const recipients = (process.env.NOTIFY_EMAIL || NOTIFY_EMAIL_DEFAULT)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!apiKey) {
    // Graceful no-op: never break orders because email isn't configured.
    // Log one entry per recipient — mirrors the per-recipient real sends.
    for (const recipient of recipients) {
      console.log(
        `[order] RESEND_API_KEY not set — would email ${recipient}:\nSubject: ${subject}\n${text}`
      );
    }
    return {
      sent: false,
      sentCount: 0,
      failedCount: 0,
      reason: "email-not-configured",
    };
  }

  // One Resend call per recipient so a single bounced/rejected inbox can't
  // prevent the other owner address from being notified.
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
            subject,
            text,
            html,
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          console.error(
            `[order] Resend send to ${recipient} failed (${res.status}): ${body.slice(0, 300)}`
          );
          return false;
        }
        console.log(
          `[order] Notification email sent to ${recipient}: ${subject}`
        );
        return true;
      } catch (error) {
        console.error(`[order] Resend request error for ${recipient}:`, error);
        return false;
      }
    })
  );

  const sentCount = outcomes.filter(Boolean).length;
  const failedCount = outcomes.length - sentCount;
  return {
    sent: sentCount > 0,
    sentCount,
    failedCount,
    ...(sentCount === 0 ? { reason: "resend-failed-all-recipients" } : {}),
  };
}

// --- Buyer confirmation email ----------------------------------------------------

async function sendBuyerConfirmationEmail(
  order: ValidatedOrder,
  orderNumber: string
): Promise<{ sent: boolean; reason?: string }> {
  if (!order.email) {
    return { sent: false, reason: "no-buyer-email" };
  }
  const { subject, text, html } = buildBuyerOrderEmail(
    toOrderEmailInput(order, orderNumber)
  );
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    // Graceful no-op: never break orders because email isn't configured.
    console.log(
      `[order] RESEND_API_KEY not set — would email buyer ${order.email}:\nSubject: ${subject}\n${text}`
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
        from: BUYER_EMAIL_FROM,
        to: [order.email],
        reply_to: BUYER_REPLY_TO,
        subject,
        text,
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(
        `[order] Buyer confirmation send failed (${res.status}): ${body.slice(0, 300)}`
      );
      return { sent: false, reason: `resend-${res.status}` };
    }
    console.log(
      `[order] Buyer confirmation email sent to ${order.email}: ${subject}`
    );
    return { sent: true };
  } catch (error) {
    console.error("[order] Buyer confirmation request error:", error);
    return { sent: false, reason: "resend-network-error" };
  }
}

// --- Handler --------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  }
  const cors = corsHeaders(origin);

  if (isRateLimited(clientIp(request))) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429, headers: cors }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: cors }
    );
  }

  // Dynamic catalog — names, prices and stock all come from here. A read
  // failure is a hard error: validating prices/stock against stale guesses
  // would be worse than asking the buyer to retry.
  let catalog: Product[];
  try {
    catalog = await getCatalog();
  } catch (error) {
    console.error("[order] Catalog read failed:", error);
    return NextResponse.json(
      { error: "The shop is temporarily unavailable. Please try again shortly." },
      { status: 503, headers: cors }
    );
  }

  const result = validateOrder(body, catalog);
  if (!result.ok) {
    return NextResponse.json(
      { error: "Validation failed", fields: result.fields },
      { status: 400, headers: cors }
    );
  }

  const orderNumber = generateOrderNumber();

  // Decrement tracked stock now that the order is accepted. Read-modify-write
  // with tolerable races at this volume; a failure here must never fail the
  // order — the team reconciles stock from the admin panel if it ever drifts.
  // Pre/post quantities are derived from the catalog already read above
  // (mirroring decrementQuantities' floor-at-0 arithmetic) so the low-stock
  // push below needs no second catalog read.
  const stockChanges: StockChange[] = result.order.lines.flatMap((l) =>
    typeof l.product.quantity === "number"
      ? [
          {
            slug: l.product.slug,
            name: l.product.en.name,
            before: l.product.quantity,
            after: Math.max(0, l.product.quantity - l.qty),
          },
        ]
      : []
  );
  let stockDecremented = false;
  try {
    await decrementQuantities(
      result.order.lines.map((l) => ({ slug: l.product.slug, qty: l.qty }))
    );
    stockDecremented = true;
  } catch (error) {
    console.error(`[order] Stock decrement failed for ${orderNumber}:`, error);
  }

  // Persist to Vercel Blob FIRST so the admin inbox sees the order even if
  // both mailers fail. A Blob failure must never fail the order either —
  // the team still gets the notification email with all details.
  const createdAt = new Date().toISOString();
  const record: StoredOrder = {
    orderNumber,
    createdAt,
    status: "ordered",
    items: result.order.lines.map((l) => ({
      slug: l.product.slug,
      qty: l.qty,
      names: { en: l.product.en.name, ar: l.product.ar.name },
      lineTotals: { egp: l.lineEgp },
    })),
    totals: { egp: result.order.totalEgp },
    name: result.order.name,
    phone: result.order.phone,
    email: result.order.email,
    address: result.order.address,
    note: result.order.note,
    lang: result.order.lang,
    statusHistory: [{ status: "ordered", at: createdAt }],
  };
  let stored = false;
  try {
    await saveOrder(record);
    stored = true;
  } catch (error) {
    console.error(`[order] Blob persistence failed for ${orderNumber}:`, error);
  }

  // Mailer failures must never fail the order — respond 200 with emailed:false.
  // The buyer confirmation is fully independent of the team's notification:
  // each has its own try/catch, and both outcomes are reported separately.
  const emailResult = await sendNotificationEmail(result.order, orderNumber);
  const buyerEmailResult = await sendBuyerConfirmationEmail(
    result.order,
    orderNumber
  );

  // Instant Telegram pushes to the team (best effort by contract — see
  // @/lib/assistant/notify; a Telegram failure can never fail the order,
  // and both silently no-op without a bot token / bound owner). The order
  // push is sent even when Blob persistence failed — the team should still
  // hear about the order; a tapped button on an unstored order just answers
  // "Order not found". Stock alerts only fire when the decrement really ran.
  await notifyNewOrder(record);
  if (stockDecremented) {
    await notifyStockChanges(stockChanges);
  }

  return NextResponse.json(
    {
      received: true,
      orderNumber,
      stored,
      emailed: emailResult.sent,
      ownerEmails: {
        sent: emailResult.sentCount,
        failed: emailResult.failedCount,
      },
      buyerEmailed: buyerEmailResult.sent,
    },
    { headers: cors }
  );
}
