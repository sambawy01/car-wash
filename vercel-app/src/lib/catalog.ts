import { get, put } from "@vercel/blob";
import { SHOP_PRODUCTS } from "./shop-products";

/**
 * Dynamic shop catalog on Vercel Blob (private store `vv-orders`).
 *
 * Layout: ONE JSON document at `catalog/products.json` holding the full
 * product array. The shop is tiny (a handful of products), so a single
 * read-modify-write document is simpler and safer than per-product blobs.
 *
 * Lifecycle:
 * - When the blob does not exist yet, `getCatalog()` returns SEED — the
 *   six launch products from @/lib/shop-products (names/prices) merged with
 *   the marketing copy/photos that previously lived only in /shop.js. The
 *   blob is written lazily on the first admin save (or the first order
 *   decrement), so a fresh deployment works with zero setup.
 * - `effectiveSoldOut(p)` is the single sold-out rule: manual flag OR a
 *   tracked quantity that reached 0. `quantity: null` means "not tracked".
 * - Orders decrement quantities via read-modify-write. At this shop's
 *   volume (a few orders a day) racing writers are tolerable by design.
 */

export interface ProductCopy {
  name: string;
  sub: string;
  desc: string;
}

export interface Product {
  slug: string;
  en: ProductCopy;
  ar: ProductCopy;
  priceEgp: number;
  /** Absolute URL (blob upload) or site-relative path ("assets/img/…"). */
  photo: string;
  alt: { en: string; ar: string };
  /** null = stock not tracked; 0 = auto sold-out. */
  quantity: number | null;
  /** Manual sold-out flag, independent of quantity. */
  soldOut: boolean;
  /** Hidden products stay in the catalog but never reach the public API. */
  active: boolean;
  /**
   * Manufacturer usage/application directions (optional, editable in /admin).
   * Surfaced to the AI concierge and the public API so clients can be told
   * how to use what they bought — "according to the manufacturer".
   */
  usage?: { en: string; ar: string };
  createdAt: string;
  updatedAt: string;
}

/** Shape served by the public GET /api/products — no internal fields. */
export interface PublicProduct {
  slug: string;
  name: { en: string; ar: string };
  sub: { en: string; ar: string };
  desc: { en: string; ar: string };
  priceEgp: number;
  photo: string;
  alt: { en: string; ar: string };
  soldOut: boolean;
  /** Manufacturer usage directions, when provided. */
  usage?: { en: string; ar: string };
}

export const CATALOG_PATHNAME = "catalog/products.json";

// --- Seed --------------------------------------------------------------------

const SEED_TIMESTAMP = "2026-06-24T00:00:00.000Z";
const SEED_QUANTITY = 20;

/**
 * Marketing copy / photos for the six launch products, keyed by the slugs in
 * @/lib/shop-products (the SEED source of truth for slugs/names/prices).
 * This text previously lived only in the static site's /shop.js.
 */
const SEED_COPY: Record<
  string,
  { sub: { en: string; ar: string }; desc: { en: string; ar: string }; photo: string; alt: { en: string; ar: string } }
> = {
  "premium-car-shampoo": {
    sub: { en: "1L bottle", ar: "عبوة 1 لتر" },
    desc: {
      en: "Premium pH-balanced car shampoo that lifts dirt and grime without stripping wax or sealant. High-foam formula for a streak-free finish, safe on all paint types.",
      ar: "شامبو سيارات فاخر متوازن الحموضة يزيل الأوساخ دون إزالة طبقة الواكس أو السيلانت. تركيبة رغوية عالية للمعان بدون بقع، آمنة على جميع أنواع الطلاء.",
    },
    photo: "assets/img/shop/premium-car-shampoo.jpg",
    alt: {
      en: "Premium Car Shampoo — 1L bottle with a blue label",
      ar: "شامبو سيارات فاخر — عبوة 1 لتر بملصق أزرق",
    },
  },
  "ceramic-wax-spray": {
    sub: { en: "500ml spray bottle", ar: "عبوة رش 500 مل" },
    desc: {
      en: "Ceramic-infused spray wax for instant gloss and hydrophobic protection. Spray on, wipe off — adds months of water-beading shine in minutes.",
      ar: "واكس سيراميك سبراي لمعان فوري وحماية طاردة للماء. يُرش ويُمسح — يضيف أشهر من لمعان مقاوم للماء في دقائق.",
    },
    photo: "assets/img/shop/ceramic-wax-spray.jpg",
    alt: {
      en: "Ceramic Wax Spray — 500ml black spray bottle",
      ar: "سيراميك وكس سبراي — عبوة رش سوداء 500 مل",
    },
  },
  "microfiber-cloth-set": {
    sub: { en: "3 pack", ar: "عبوة 3 قطع" },
    desc: {
      en: "Ultra-soft microfiber detailing cloths — set of 3. Scratch-free, lint-free, highly absorbent. Perfect for drying, buffing, and applying products.",
      ar: "أقمشة مايكروفايبر ناعمة جداً لتنظيف السيارات — طقم 3 قطع. خالية من الخدوش والوبر، عالية الامتصاص. مثالية للتجفيف والتلميع وتطبيق المنتجات.",
    },
    photo: "assets/img/shop/microfiber-cloth-set.jpg",
    alt: {
      en: "Microfiber Cloth Set — three folded cloths in blue, grey and green",
      ar: "طقم أقمشة مايكروفايبر — ثلاث أقمشة مطوية باللون الأزرق والرمادي والأخضر",
    },
  },
  "tire-shine-gel": {
    sub: { en: "500ml bottle", ar: "عبوة 500 مل" },
    desc: {
      en: "Long-lasting tire shine gel for a rich, satin-black finish. Repels water and road dust, keeps tires looking new for weeks.",
      ar: "جل تلميع الإطارات يدوم طويلاً للمعان أسود حريري. يطرد الماء والأتربة، يحافظ على إطارات تبدو جديدة لأسابيع.",
    },
    photo: "assets/img/shop/tire-shine-gel.jpg",
    alt: {
      en: "Tire Shine Gel — 500ml bottle with a black cap",
      ar: "جل تلميع الإطارات — عبوة 500 مل بغطاء أسود",
    },
  },
  "interior-cleaner-spray": {
    sub: { en: "750ml spray bottle", ar: "عبوة رش 750 مل" },
    desc: {
      en: "Multi-surface interior cleaner for dashboards, plastics, vinyl and leather. Removes dust, stains and fingerprints without leaving residue or greasiness.",
      ar: "منظف داخلي متعدد الأسطح للطابلون والبلاستيك والفينيل والجلد. يزيل الأتربة والبقع وبصمات الأصابع دون ترك بقايا أو دهونية.",
    },
    photo: "assets/img/shop/interior-cleaner-spray.jpg",
    alt: {
      en: "Interior Cleaner Spray — 750ml spray bottle with a green label",
      ar: "منظف الداخل سبراي — عبوة رش 750 مل بملصق أخضر",
    },
  },
  "waterless-wash-spray": {
    sub: { en: "500ml spray bottle", ar: "عبوة رش 500 مل" },
    desc: {
      en: "Eco-friendly waterless wash spray — lifts and encapsulates dirt so you can wipe clean without a hose. Safe on paint, glass and trim. Saves up to 100 litres of water per wash.",
      ar: "سبراي غسيل بدون مياه صديق للبيئة — يرفع ويحيط الأوساخ لمسحها بدون خرطوم. آمن على الطلاء والزجاج والبروفايل. يوفر حتى 100 لتر ماء لكل غسلة.",
    },
    photo: "assets/img/shop/waterless-wash-spray.jpg",
    alt: {
      en: "Waterless Wash Spray — 500ml spray bottle with a green and blue label",
      ar: "سبراي غسيل بدون مياه — عبوة رش 500 مل بملصق أخضر وأزرق",
    },
  },
};

/**
 * Usage/application directions, condensed faithfully from the product pages.
 * No invented claims — wording stays within what the manufacturer publishes.
 */
const SEED_USAGE: Record<string, { en: string; ar: string }> = {
  "premium-car-shampoo": {
    en: "Dilute 2–3 capfuls in a bucket of clean water. Wash from the top down with a microfiber mitt. Rinse thoroughly and dry with a microfiber cloth.",
    ar: "أضف 2–3 أغطية إلى دلو من الماء النظيف. اغسل من أعلى إلى أسفل باستخدام قفاز مايكروفايبر. اشطف جيداً وجفف بقطعة مايكروفايبر.",
  },
  "ceramic-wax-spray": {
    en: "Spray onto a clean, dry panel and immediately wipe with a microfiber cloth. Flip the cloth and buff lightly for a high-gloss finish. Apply every 4–6 weeks for best protection.",
    ar: "رش على لوح نظيف وجاف وامسح فوراً بقطعة مايكروفايبر. اقلب القماش ولمع برفق للحصول على لمعان عالي. كرر كل 4–6 أسابيع للحماية المثلى.",
  },
  "microfiber-cloth-set": {
    en: "Wash before first use. Use separate cloths for dirty work and buffing. Machine wash warm, no fabric softener, tumble dry low.",
    ar: "اغسل قبل أول استخدام. استخدم أقمشة منفصلة للأعمال المتسخة والتلميع. اغسل في الغسالة بماء دافئ بدون ملطف نسيج، جفف على حرارة منخفضة.",
  },
  "tire-shine-gel": {
    en: "Apply a small amount to a sponge or applicator pad and spread evenly on a clean, dry tire sidewall. Allow to dry for 10–15 minutes before driving.",
    ar: "ضع كمية صغيرة على إسفنجة أو وسادة تطبيق ووزّعها بالتساوي على جدار الإطار النظيف الجاف. اتركها تجف 10–15 دقيقة قبل القيادة.",
  },
  "interior-cleaner-spray": {
    en: "Spray directly onto the surface or a microfiber cloth. Wipe clean, then buff with a dry side of the cloth. Test on an inconspicuous area first.",
    ar: "رش مباشرة على السطح أو على قطعة مايكروفايبر. امسح نظيفاً ثم لمع بالجانب الجاف من القماش. اختبر على منطقة غير ظاهرة أولاً.",
  },
  "waterless-wash-spray": {
    en: "Spray generously onto one panel at a time. Let it soak for 30 seconds to encapsulate dirt. Wipe gently with a microfiber cloth in one direction, then buff dry with a clean side. Do not use on heavily soiled or muddy surfaces.",
    ar: "رش بوفرة على لوح واحد في كل مرة. اتركه 30 ثانية لتحييط الأوساخ. امسح برفق بقطعة مايكروفايبر في اتجاه واحد، ثم جفف ولمع بجانب نظيف. لا تستخدم على أسطح متسخة جداً أو موحلة.",
  },
};

/** Short names for the catalog (without the size suffix that lives in `sub`). */
const SEED_SHORT_NAMES: Record<string, { en: string; ar: string }> = {
  "premium-car-shampoo": { en: "Premium Car Shampoo", ar: "شامبو سيارات فاخر" },
  "ceramic-wax-spray": { en: "Ceramic Wax Spray", ar: "سيراميك وكس سبراي" },
  "microfiber-cloth-set": { en: "Microfiber Cloth Set", ar: "طقم أقمشة مايكروفايبر" },
  "tire-shine-gel": { en: "Tire Shine Gel", ar: "جل تلميع الإطارات" },
  "interior-cleaner-spray": { en: "Interior Cleaner Spray", ar: "منظف الداخل سبراي" },
  "waterless-wash-spray": { en: "Waterless Wash Spray", ar: "سبراي غسيل بدون مياه" },
};

export const SEED: readonly Product[] = SHOP_PRODUCTS.map((p) => {
  const copy = SEED_COPY[p.slug];
  const names = SEED_SHORT_NAMES[p.slug];
  return {
    slug: p.slug,
    en: {
      name: names?.en ?? p.nameEn,
      sub: copy?.sub.en ?? "",
      desc: copy?.desc.en ?? "",
    },
    ar: {
      name: names?.ar ?? p.nameAr,
      sub: copy?.sub.ar ?? "",
      desc: copy?.desc.ar ?? "",
    },
    priceEgp: p.priceEgp,
    photo: copy?.photo ?? "",
    alt: copy?.alt ?? { en: "", ar: "" },
    ...(SEED_USAGE[p.slug] ? { usage: SEED_USAGE[p.slug] } : {}),
    quantity: SEED_QUANTITY,
    soldOut: false,
    active: true,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  };
});

function cloneSeed(): Product[] {
  return SEED.map((p) => ({
    ...p,
    en: { ...p.en },
    ar: { ...p.ar },
    alt: { ...p.alt },
    ...(p.usage ? { usage: { ...p.usage } } : {}),
  }));
}

// --- Sold-out rule ------------------------------------------------------------

/** The single source of truth: manual flag OR tracked stock at zero. */
export function effectiveSoldOut(p: Product): boolean {
  return p.soldOut || p.quantity === 0;
}

export function toPublicProduct(p: Product): PublicProduct {
  return {
    slug: p.slug,
    name: { en: p.en.name, ar: p.ar.name },
    sub: { en: p.en.sub, ar: p.ar.sub },
    desc: { en: p.en.desc, ar: p.ar.desc },
    priceEgp: p.priceEgp,
    photo: p.photo,
    alt: { ...p.alt },
    soldOut: effectiveSoldOut(p),
    ...(p.usage && (p.usage.en || p.usage.ar)
      ? { usage: { ...p.usage } }
      : {}),
  };
}

// --- Persistence ----------------------------------------------------------------

/**
 * Read the full catalog. A missing blob (fresh store) falls back to SEED;
 * any other failure throws so callers can decide how to degrade — a transient
 * read error must never be mistaken for "empty store" by a writer, or a
 * subsequent save would clobber the real catalog with seed data.
 */
export async function getCatalog(): Promise<Product[]> {
  const result = await get(CATALOG_PATHNAME, {
    access: "private",
    useCache: false,
  });
  // The SDK returns null for a missing blob (fresh store) and throws on
  // transport/auth errors — those propagate to the caller.
  if (!result) return cloneSeed();
  const data = (await new Response(result.stream).json()) as unknown;
  if (!Array.isArray(data)) {
    throw new Error("Catalog blob is corrupt (not an array)");
  }
  return data as Product[];
}

/** Overwrite the catalog document (also performs the lazy first write of SEED edits). */
export async function saveCatalog(products: Product[]): Promise<void> {
  await put(CATALOG_PATHNAME, JSON.stringify(products, null, 2), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

/**
 * Decrement tracked stock after a successful order (read-modify-write).
 * Quantities floor at 0 — which makes the product auto sold-out for all
 * subsequent catalog fetches. Untracked products (quantity: null) and
 * unknown slugs are skipped. Races at this volume are acceptable.
 */
export async function decrementQuantities(
  items: { slug: string; qty: number }[]
): Promise<void> {
  const catalog = await getCatalog();
  const now = new Date().toISOString();
  let changed = false;
  for (const { slug, qty } of items) {
    const product = catalog.find((p) => p.slug === slug);
    if (product && typeof product.quantity === "number") {
      product.quantity = Math.max(0, product.quantity - qty);
      product.updatedAt = now;
      changed = true;
    }
  }
  if (changed) await saveCatalog(catalog);
}

/**
 * Restore tracked stock when an order is cancelled (read-modify-write).
 * The mirror of `decrementQuantities`: quantities are added back only for
 * items that still exist in the catalog AND still track stock — deleted
 * products and untracked (`quantity: null`) ones are skipped. Races at this
 * volume are acceptable.
 */
export async function restoreQuantities(
  items: { slug: string; qty: number }[]
): Promise<void> {
  const catalog = await getCatalog();
  const now = new Date().toISOString();
  let changed = false;
  for (const { slug, qty } of items) {
    const product = catalog.find((p) => p.slug === slug);
    if (product && typeof product.quantity === "number") {
      product.quantity = product.quantity + qty;
      product.updatedAt = now;
      changed = true;
    }
  }
  if (changed) await saveCatalog(catalog);
}

// --- Slugs -----------------------------------------------------------------------

/**
 * Kebab-case slug from the EN name, made unique against the existing catalog
 * by appending -2, -3, … Slugs are immutable after creation (they live in
 * carts, orders and bookmarks).
 */
export function generateSlug(nameEn: string, existing: Set<string>): string {
  const base =
    nameEn
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "product";
  if (!existing.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
}

// --- Price formatting (kept in the catalog module so the order path no longer
// imports @/lib/shop-products, which is now only the SEED source) -----------------

/** "3540" -> "E£3,540". */
export function formatEgp(amount: number): string {
  return `E£${amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}