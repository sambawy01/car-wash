/**
 * Service catalogue for Elite Eco Car Wash.
 * eventTypeId values are the Cal.com event types created by
 * scripts/create-event-types.mjs — every one requires confirmation.
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
    eventTypeId: 0,
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
    eventTypeId: 0,
    en: { title: "Wheel Cleaning" },
    ar: { title: "تنظيف الجنوط" },
    durations: [30],
    priceLine: { en: "E£140", ar: "E£140" },
    price: { egp: 140 },
  },
  {
    slug: "engine-cleaning",
    eventTypeId: 0,
    en: { title: "Engine Cleaning" },
    ar: { title: "تنظيف المحرك" },
    durations: [30],
    priceLine: { en: "E£230", ar: "E£230" },
    price: { egp: 230 },
  },
  {
    slug: "polishing-protection",
    eventTypeId: 0,
    en: { title: "Polishing & Protection" },
    ar: { title: "تلميع وحماية الطلاء" },
    durations: [90],
    priceLine: { en: "E£700", ar: "E£700" },
    price: { egp: 700 },
  },
  {
    slug: "steam-cleaning",
    eventTypeId: 0,
    en: { title: "Steam Cleaning" },
    ar: { title: "تنظيف وتعقيم بالبخار" },
    durations: [60],
    priceLine: { en: "E£330", ar: "E£330" },
    price: { egp: 330 },
  },
  {
    slug: "waterless-wash",
    eventTypeId: 0,
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

/**
 * Multi-service sessions are booked on a single shared Cal.com event type
 * created by scripts/create-combined-session.mjs. Its lengthInMinutesOptions
 * cover every achievable sum of 2–4 services (longest duration per service,
 * capped at 180 min) plus all single-service durations.
 */
export const COMBINED_SESSION = {
  slug: "combined-session",
  eventTypeId: 0,
} as const;

export const COMBINED_DURATION_OPTIONS: readonly number[] = [
  30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180,
];

export const MAX_COMBINED_MINUTES = 180;

/** Longest duration of a service — combined sessions always use this. */
export function longestDuration(service: Service): number {
  return Math.max(...service.durations);
}