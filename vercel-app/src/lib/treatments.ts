import { get, put } from "@vercel/blob";

/**
 * Dynamic services catalog on Vercel Blob (private store `vv-orders`),
 * mirroring the shop catalog in @/lib/catalog.
 *
 * Layout: ONE JSON document at `catalog/treatments.json` holding the full
 * service array (6 services — a single read-modify-write document).
 */

export interface Treatment {
  slug: string;
  /** Linked Cal.com event type (api.cal.eu). 0 = no linked event type. */
  eventTypeId: number;
  name: { en: string; ar: string };
  description: { en: string; ar: string };
  durationMinutes: number;
  priceEgp: number;
  /** Deactivated services stay in the catalog but never reach the public API. */
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

export const SEED: readonly Treatment[] = [
  {
    slug: "interior-exterior-wash",
    eventTypeId: 345762,
    name: { en: "Interior & Exterior Wash", ar: "غسيل داخلي وخارجي" },
    description: {
      en: "Complete interior vacuum, dashboard cleaning, and exterior foam wash with hot wax",
      ar: "شفط كامل للداخل، تنظيف لوحة القيادة، وغسيل رغوي للخارج مع شمع ساخن",
    },
    durationMinutes: 75,
    priceEgp: 370,
    active: true,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
  {
    slug: "wheel-cleaning",
    eventTypeId: 345763,
    name: { en: "Wheel Cleaning", ar: "تنظيف الجنوط" },
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
    eventTypeId: 345764,
    name: { en: "Engine Cleaning", ar: "تنظيف المحرك" },
    description: {
      en: "Safe engine bay degreasing and dressing",
      ar: "إزالة شحوم آمنة لحجرة المحرك وتلميع",
    },
    durationMinutes: 30,
    priceEgp: 230,
    active: true,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
  {
    slug: "polishing-protection",
    eventTypeId: 345765,
    name: { en: "Polishing & Protection", ar: "تلميع وحماية الطلاء" },
    description: {
      en: "Machine polishing with protective wax coating for long-lasting shine",
      ar: "تلميع بالماكينة مع طبقة شمع حماية لمعان يدوم طويلاً",
    },
    durationMinutes: 90,
    priceEgp: 700,
    active: true,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
  {
    slug: "steam-cleaning",
    eventTypeId: 345766,
    name: { en: "Steam Cleaning", ar: "تنظيف وتعقيم بالبخار" },
    description: {
      en: "Sanitizing steam clean for interior surfaces and upholstery",
      ar: "تنظيف وتعقيم بالبخار للأسطح الداخلية والمقاعد",
    },
    durationMinutes: 60,
    priceEgp: 330,
    active: true,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
  {
    slug: "waterless-wash",
    eventTypeId: 345767,
    name: { en: "Waterless Wash", ar: "غسيل بدون مياه" },
    description: {
      en: "Eco-friendly waterless wash using premium spray products",
      ar: "غسيل صديق للبيئة بدون مياه باستخدام منتجات بخاخ فاخرة",
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

export async function getTreatmentsCatalog(): Promise<Treatment[]> {
  const result = await get(TREATMENTS_PATHNAME, {
    access: "private",
    useCache: false,
  });
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
      .replace(/-+$/, "") || "service";
  if (!existing.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
}