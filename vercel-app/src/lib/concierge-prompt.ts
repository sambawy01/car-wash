import {
  effectiveSoldOut,
  formatEgp,
  type Product,
} from "@/lib/catalog";
import { SEED as TREATMENTS_SEED, type Treatment } from "@/lib/treatments";
import { SERVICES } from "@/lib/services";

/**
 * Single source of truth for the AI concierge knowledge base and system prompt.
 * Elite Eco Car Wash — services, prices, durations, brand facts.
 */

export const BRAND = {
  name: "Elite Eco Car Wash",
  facts:
    "Elite Eco Car Wash is a mobile car wash service based in El Gouna, Egypt. " +
    "We bring the car wash to you — at home, at the office, or anywhere. " +
    "Eco-friendly and water-saving approach using premium, safe products. " +
    "Services include interior & exterior wash, wheel cleaning, engine cleaning, " +
    "polishing & protection, steam cleaning, and waterless wash. " +
    "The shop sells premium car care products (cash on delivery, 24–72h delivery across Egypt) — see SHOP PRODUCTS.",
  whatsappNumber: "011111147766",
  whatsappLink: "https://wa.me/201111147766",
  bookingLink: "https://book.eliteecocarwash.com/book",
  contactEmail: "info@eliteecocarwash.com",
};

/**
 * Per-duration price variants for the multi-duration SEED services — the
 * SAME options /book offers.
 */
const SEED_VARIANTS: Record<
  string,
  readonly { minutes: number; egp: number }[]
> = {
  "interior-exterior-wash": [
    { minutes: 60, egp: 320 },
    { minutes: 75, egp: 370 },
  ],
};

function matchesStaticService(t: Treatment): boolean {
  const s = SERVICES.find((x) => x.slug === t.slug);
  return Boolean(
    s &&
      s.eventTypeId === t.eventTypeId &&
      Math.max(...s.durations) === t.durationMinutes &&
      s.price.egp === t.priceEgp &&
      s.en.title === t.name.en &&
      s.ar.title === t.name.ar
  );
}

function formatTreatment(t: Treatment): string {
  const desc =
    t.description.en || t.description.ar
      ? ` (${[t.description.en, t.description.ar].filter(Boolean).join(" / ")})`
      : "";
  const variants = SEED_VARIANTS[t.slug];
  const priced =
    variants && matchesStaticService(t)
      ? variants
          .map(
            (v) =>
              `${v.minutes} min — ${formatEgp(v.egp)}`
          )
          .join("; ")
      : `${t.durationMinutes} min — ${formatEgp(t.priceEgp)}`;
  return `- ${t.name.en} / ${t.name.ar}${desc} — ${priced}`;
}

function formatShopProduct(p: Product): string {
  const sub = p.en.sub ? ` (${p.en.sub} / ${p.ar.sub})` : "";
  const availability = effectiveSoldOut(p)
    ? "SOLD OUT — currently unavailable, cannot be ordered right now"
    : "in stock";
  const desc =
    p.en.desc || p.ar.desc
      ? ` Description: ${[p.en.desc, p.ar.desc].filter(Boolean).join(" / AR: ")}`
      : "";
  const usage =
    p.usage && (p.usage.en || p.usage.ar)
      ? ` USAGE (manufacturer's directions): ${[p.usage.en, p.usage.ar].filter(Boolean).join(" / AR: ")}`
      : "";
  return `- ${p.en.name} / ${p.ar.name}${sub} — ${formatEgp(p.priceEgp)} — ${availability}.${desc}${usage}`;
}

export function buildSystemPrompt(
  lang: "en" | "ar",
  products: readonly Product[] = [],
  treatments: readonly Treatment[] = TREATMENTS_SEED
): string {
  const shopSection =
    products.length > 0
      ? `
SHOP PRODUCTS (premium car care — cash on delivery, 24–72h delivery across Egypt; EN / AR names, Egyptian Pounds):
${products.map(formatShopProduct).join("\n")}`
      : "";

  return `You are "Eco", the AI assistant for ${BRAND.name}. When asked who you are, introduce yourself as Eco, Elite Eco Car Wash's AI assistant.

ABOUT THE SERVICE:
${BRAND.facts}

SERVICES (EN / AR — Egyptian Pounds, with durations):
${treatments.map(formatTreatment).join("\n")}${shopSection}

BOOKING & CONTACT:
Clients book services directly online at ${BRAND.bookingLink} (no intermediary needed).
General contact email: ${BRAND.contactEmail}.
WhatsApp ${BRAND.whatsappNumber} (${BRAND.whatsappLink}) is for direct inquiries.

STRICT RULES:
1. Answer ONLY about these services, the shop products, car care advice related to them, their prices, durations, availability, and booking. For anything off-topic, politely decline and steer the conversation back to the car wash services.
2. Reply in the user's language. (UI language hint: ${lang === "ar" ? "Arabic" : "English"} — but always follow the language the user actually writes in.)
3. Keep answers to 120 words or fewer.
4. NEVER invent services, prices, durations, or claims. Only use the exact data above.
5. When the user shows booking intent, mention that services can be booked directly online and end your answer with the booking page link: ${BRAND.bookingLink}
6. Offer WhatsApp (${BRAND.whatsappNumber}, ${BRAND.whatsappLink}) when the client explicitly asks to speak with someone or has a specific question about their vehicle.
7. You MAY share the manufacturer's usage directions for the shop products listed above (the USAGE text) when clients ask how to use a product — present them as the manufacturer's recommendations ("according to the manufacturer"). Mention a product's availability when relevant (sold-out products cannot be ordered right now). Do NOT invent directions beyond the USAGE text.`;
}