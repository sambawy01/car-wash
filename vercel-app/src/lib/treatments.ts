import { get, put } from "@vercel/blob";

/**
 * Dynamic treatments catalog on Vercel Blob (private store `vv-orders`),
 * mirroring the shop catalog in @/lib/catalog.
 *
 * Layout: ONE JSON document at `catalog/treatments.json` holding the full
 * treatment array (6 services — a single read-modify-write document).
 *
 * Lifecycle:
 * - When the blob does not exist yet, `getTreatmentsCatalog()` returns SEED —
 *   the 6 live services exactly as rendered on the static site and /book
 *   today, each linked to its Cal.com event type. The blob is written lazily
 *   on the first admin save, so a fresh deployment works with zero setup.
 * - A treatment's PRICE lives only here — Cal.com event types carry no price
 *   today and that stays the case. Name/duration changes are best-effort
 *   synced to the linked Cal event type by the admin routes.
 * - Deactivating (active: false) hides the treatment from the public API and
 *   best-effort hides the Cal event type (hidden: true).
 */

export interface Treatment {
  slug: string;
  /** Linked Cal.com event type. 0 = no linked event type. */
  eventTypeId: number;
  name: { en: string; ar: string };
  description: { en: string; ar: string };
  durationMinutes: number;
  priceEgp: number;
  /** Deactivated treatments stay in the catalog but never reach the public API. */
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Shape served by the public GET /api/treatments — no internal timestamps. */
export interface PublicTreatment {
  slug: string;
  eventTypeId: number;
  name: { en: string; ar: string };
  description: { en: string; ar: string };
  durationMinutes: number;
  priceEgp: number;
}

export const TREATMENTS_PATHNAME = "catalog/treatments.json";

// --- Seed --------------------------------------------------------------------

const SEED_TIMESTAMP = "2026-06-24T00:00:00.000Z";

/**
 * The 6 live car wash services. Prices include the current rate.
 * Descriptions are the sub-lines from the static pages.
 */
export const SEED: readonly Treatment[] = [
  {
    slug: "interior-exterior-wash",
    eventTypeId: 0,
    name: {
      en: "Interior & Exterior Wash",
      ar: "غسيل داخلي وخارجي",
    },
    description: {
      en: "Complete interior vacuum, dashboard cleaning, and exterior foam wash with hot wax",
      ar: "تنظيف داخلي شامل بالمكنسة الكهربائية وتنظيف الطابلون وغسيل خارجي بالرغوة مع واكس ساخن",
    },
    durationMinutes: 75,
    priceEgp: 370,
    active: true,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
  {
    slug: "wheel-cleaning",
    eventTypeId: 0,
    name: {
      en: "Wheel Cleaning",
      ar: "تنظيف الجنوط",
    },
    description: {
      en: "Deep cleaning for alloy wheels, tires, and wheel arches",
      ar: "تنظيف عميق للجنوط والإطارات وأقواس العجلات",
    },
    durationMinutes: 30,
    priceEgp: 140,
    active: true,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
  {
    slug: "engine-cleaning",
    eventTypeId: 0,
    name: {
      en: "Engine Cleaning",
      ar: "تنظيف المحرك",
    },
    description: {
      en: "Safe engine bay degreasing and dressing",
      ar: "إزالة الشحوم من حوض المحرك بأمان وتلميعه",
    },
    durationMinutes: 30,
    priceEgp: 230,
    active: true,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
  {
    slug: "polishing-protection",
    eventTypeId: 0,
    name: {
      en: "Polishing & Protection",
      ar: "تلميع وحماية الطلاء",
    },
    description: {
      en: "Machine polishing with protective wax coating for long-lasting shine",
      ar: "تلميع بالماكينة مع طبقة حماية بالواكس لبريق يدوم طويلاً",
    },
    durationMinutes: 90,
    priceEgp: 700,
    active: true,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
  {
    slug: "steam-cleaning",
    eventTypeId: 0,
    name: {
      en: "Steam Cleaning",
      ar: "تنظيف وتعقيم بالبخار",
    },
    description: {
      en: "Sanitizing steam clean for interior surfaces and upholstery",
      ar: "تنظيف وتعقيم بالبخار للأسطح الداخلية والتنجيد",
    },
    durationMinutes: 60,
    priceEgp: 330,
    active: true,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
  {
    slug: "waterless-wash",
    eventTypeId: 0,
    name: {
      en: "Waterless Wash",
      ar: "غسيل بدون مياه",
    },
    description: {
      en: "Eco-friendly waterless wash using premium spray products",
      ar: "غسيل صديق للبيئة بدون مياه باستخدام منتجات رش فاخرة",
    },
    durationMinutes: 45,
    priceEgp: 220,
    active: true,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
];

function cloneSeed(): Treatment[] {
  return SEED.map((t) => ({
    ...t,
    name: { ...t.name },
    description: { ...t.description },
  }));
}

export function toPublicTreatment(t: Treatment): PublicTreatment {
  return {
    slug: t.slug,
    eventTypeId: t.eventTypeId,
    name: { ...t.name },
    description: { ...t.description },
    durationMinutes: t.durationMinutes,
    priceEgp: t.priceEgp,
  };
}

// --- Persistence ----------------------------------------------------------------

/** Structural check for one stored treatment entry. */
function isValidTreatment(value: unknown): value is Treatment {
  const t = value as Treatment | null;
  return (
    typeof t === "object" &&
    t !== null &&
    typeof t.slug === "string" &&
    t.slug.length > 0 &&
    typeof t.eventTypeId === "number" &&
    Number.isFinite(t.eventTypeId) &&
    typeof t.name === "object" &&
    t.name !== null &&
    typeof t.name.en === "string" &&
    t.name.en.length > 0 &&
    typeof t.name.ar === "string" &&
    typeof t.description === "object" &&
    t.description !== null &&
    typeof t.description.en === "string" &&
    typeof t.description.ar === "string" &&
    typeof t.durationMinutes === "number" &&
    Number.isFinite(t.durationMinutes) &&
    typeof t.priceEgp === "number" &&
    Number.isFinite(t.priceEgp) &&
    typeof t.active === "boolean" &&
    typeof t.createdAt === "string" &&
    typeof t.updatedAt === "string"
  );
}

/**
 * Read the full treatments catalog. A missing blob (fresh store) falls back to
 * SEED; any other failure throws so callers can decide how to degrade — a
 * transient read error must never be mistaken for "empty store" by a writer,
 * or a subsequent save would clobber the real catalog with seed data.
 *
 * Per-item shape validation throws on ANY malformed entry (same policy as the
 * not-an-array corrupt check): a garbage-but-array blob must surface as
 * corruption so readers degrade to SEED, not flow through as a valid catalog
 * — /api/treatments would otherwise serve a blanked/garbled menu and the
 * static pages would hide every treatment row.
 */
export async function getTreatmentsCatalog(): Promise<Treatment[]> {
  const result = await get(TREATMENTS_PATHNAME, {
    access: "private",
    useCache: false,
  });
  // The SDK returns null for a missing blob (fresh store) and throws on
  // transport/auth errors — those propagate to the caller.
  if (!result) return cloneSeed();
  const data = (await new Response(result.stream).json()) as unknown;
  if (!Array.isArray(data)) {
    throw new Error("Treatments blob is corrupt (not an array)");
  }
  for (const entry of data) {
    if (!isValidTreatment(entry)) {
      throw new Error(
        `Treatments blob is corrupt (malformed entry: ${JSON.stringify(entry).slice(0, 200)})`
      );
    }
  }
  return data as Treatment[];
}

/** Overwrite the treatments document (also performs the lazy first write of SEED edits). */
export async function saveTreatmentsCatalog(
  treatments: Treatment[]
): Promise<void> {
  await put(TREATMENTS_PATHNAME, JSON.stringify(treatments, null, 2), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

// --- Slugs -----------------------------------------------------------------------

/**
 * Kebab-case slug from the EN name, made unique against the existing catalog
 * by appending -2, -3, … Slugs are immutable after creation (they live in
 * booking links, the static pages and Cal event types).
 */
export function generateTreatmentSlug(
  nameEn: string,
  existing: Set<string>
): string {
  const base =
    nameEn
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "treatment";
  if (!existing.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
}