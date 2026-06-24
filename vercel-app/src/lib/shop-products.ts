/**
 * SEED-ONLY shop catalog.
 *
 * Orders are now validated against the DYNAMIC catalog in @/lib/catalog
 * (Vercel Blob `catalog/products.json`, editable from /admin). This file
 * remains solely as the seed source: when the catalog blob does not exist
 * yet, @/lib/catalog builds its SEED from these six products.
 *
 * Do NOT import this module from the order path — use @/lib/catalog.
 *
 * Prices are in EGP only (integer units, no cents).
 *
 * Slugs and prices MUST stay identical to the PRODUCTS array in /shop.js
 * (static site) — drift breaks order submission.
 */

export interface ShopProduct {
  slug: string;
  nameEn: string;
  nameAr: string;
  priceEgp: number;
}

export const SHOP_PRODUCTS: readonly ShopProduct[] = [
  {
    slug: "premium-car-shampoo",
    nameEn: "Premium Car Shampoo — 1L",
    nameAr: "شامبو سيارات فاخر — 1 لتر",
    priceEgp: 180,
  },
  {
    slug: "ceramic-wax-spray",
    nameEn: "Ceramic Wax Spray — 500ml",
    nameAr: "سيراميك وكس سبراي — 500 مل",
    priceEgp: 250,
  },
  {
    slug: "microfiber-cloth-set",
    nameEn: "Microfiber Cloth Set — 3 pack",
    nameAr: "طقم أقمشة مايكروفايبر — 3 قطع",
    priceEgp: 120,
  },
  {
    slug: "tire-shine-gel",
    nameEn: "Tire Shine Gel — 500ml",
    nameAr: "جل تلميع الإطارات — 500 مل",
    priceEgp: 150,
  },
  {
    slug: "interior-cleaner-spray",
    nameEn: "Interior Cleaner Spray — 750ml",
    nameAr: "منظف الداخل سبراي — 750 مل",
    priceEgp: 130,
  },
  {
    slug: "waterless-wash-spray",
    nameEn: "Waterless Wash Spray — 500ml",
    nameAr: "سبراي غسيل بدون مياه — 500 مل",
    priceEgp: 220,
  },
] as const;

export const PRODUCTS_BY_SLUG: ReadonlyMap<string, ShopProduct> = new Map(
  SHOP_PRODUCTS.map((p) => [p.slug, p])
);

/** "3540" -> "E£3,540" (EGP style). */
export function formatEgp(amount: number): string {
  return `E£${amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}