/**
 * Service catalogue for Elite Eco Car Wash.
 * eventTypeId values are placeholders (0) — create real Cal.com event types
 * and wire them here.
 */

export interface Service {
  slug: string;
  eventTypeId: number;
  en: { title: string };
  ar: { title: string };
  /** Available durations in minutes (ascending). Bookings default to the longest. */
  durations: number[];
  priceLine: { en: string; ar: string };
  /** Numeric price at the LONGEST duration — used to sum combined sessions. */
  price: { egp: number };
}

export const SERVICES: Service[] = [
  {
    slug: "interior-exterior-wash",
    eventTypeId: 345762,
    en: { title: "Interior & Exterior Wash" },
    ar: { title: "غسيل داخلي وخارجي" },
    durations: [60, 75],
    priceLine: {
      en: "E£320–370",
      ar: "E£320–370",
    },
    price: { egp: 370 },
  },
  {
    slug: "wheel-cleaning",
    eventTypeId: 345763,
    en: { title: "Wheel Cleaning" },
    ar: { title: "تنظيف الجنوط" },
    durations: [30],
    priceLine: { en: "E£140", ar: "E£140" },
    price: { egp: 140 },
  },
  {
    slug: "engine-cleaning",
    eventTypeId: 345764,
    en: { title: "Engine Cleaning" },
    ar: { title: "تنظيف المحرك" },
    durations: [30],
    priceLine: { en: "E£230", ar: "E£230" },
    price: { egp: 230 },
  },
  {
    slug: "polishing-protection",
    eventTypeId: 345765,
    en: { title: "Polishing & Protection" },
    ar: { title: "تلميع وحماية الطلاء" },
    durations: [90],
    priceLine: { en: "E£700", ar: "E£700" },
    price: { egp: 700 },
  },
  {
    slug: "steam-cleaning",
    eventTypeId: 345766,
    en: { title: "Steam Cleaning" },
    ar: { title: "تنظيف وتعقيم بالبخار" },
    durations: [60],
    priceLine: { en: "E£330", ar: "E£330" },
    price: { egp: 330 },
  },
  {
    slug: "waterless-wash",
    eventTypeId: 345767,
    en: { title: "Waterless Wash" },
    ar: { title: "غسيل بدون مياه" },
    durations: [45],
    priceLine: { en: "E£220", ar: "E£220" },
    price: { egp: 220 },
  },
];

export function getServiceBySlug(slug: string | undefined): Service | undefined {
  if (!slug) return undefined;
  return SERVICES.find((s) => s.slug === slug);
}

export const COMBINED_SESSION = {
  slug: "combined-session",
  eventTypeId: 345768,
} as const;

export const COMBINED_DURATION_OPTIONS: readonly number[] = [
  30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180,
];

export const MAX_COMBINED_MINUTES = 180;

export function longestDuration(service: Service): number {
  return Math.max(...service.durations);
}