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
 *
 * Shop products AND treatments are injected DYNAMICALLY: /api/chat loads the
 * live catalogs (falling back to their built-in SEEDs on a blob failure) and
 * passes them to `buildSystemPrompt`, so Eco always knows current prices,
 * durations, availability and the manufacturer's usage directions.
 */

export const BRAND = {
  name: "Elite Eco Car Wash",
  facts:
    "Elite Eco Car Wash, a mobile car wash service in El Gouna, Egypt. " +
    "We bring the car wash to you — at your home, office, or anywhere in El Gouna. " +
    "Eco-friendly approach using premium waterless and low-water products. " +
    "Professional equipment and trained staff. " +
    "The shop sells premium car care products (cash on delivery, 24–72h delivery across Egypt) — see SHOP PRODUCTS.",
  whatsappNumber: "011111147766",
  whatsappLink: "https://wa.me/201111147766",
  bookingLink: "https://book.eliteecocarwash.com/book",
  contactEmail: "info@eliteecocarwash.com",
};

/**
 * Per-duration price variants for the multi-duration SEED treatments — the
 * SAME options /book offers. Without these the concierge would quote only
 * the longest duration's price and disagree with /book.
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

/**
 * Same match /book's treatmentToService uses: while a catalog treatment is
 * still identical to its static SERVICES entry, /book serves the static
 * multi-duration entry — so the concierge must quote the variants too. Once
 * the owner edits the treatment, /book collapses it to a single duration and
 * price, and so do we.
 */
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

/** One prompt line per treatment: EN/AR names, optional sub-line, duration(s), prices. */
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

/** One prompt line per shop product: names, price, availability, copy, usage. */
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

/**
 * Build the domain-restricted system prompt for the concierge.
 * `lang` is the UI language hint; the model must still follow the user's
 * actual language. `products` is the live shop catalog (active products) and
 * `treatments` the live treatments catalog — /api/chat passes the dynamic
 * catalogs or their SEED fallbacks.
 */
export function buildSystemPrompt(
  lang: "en" | "ar",
  products: readonly Product[] = [],
  treatments: readonly Treatment[] = TREATMENTS_SEED
): string {
  const shopSection =
    products.length > 0
      ? `
SHOP PRODUCTS (car care products — cash on delivery, 24–72h delivery across Egypt; EN / AR names, Egyptian Pounds):
${products.map(formatShopProduct).join("\n")}`
      : "";

  return `You are "Eco", the AI assistant for ${BRAND.name}. When asked who you are, introduce yourself as Eco, the Elite Eco Car Wash AI assistant.

ABOUT THE SERVICE:
${BRAND.facts}

SERVICES (EN / AR — Egyptian Pounds, with durations):
${treatments.map(formatTreatment).join("\n")}${shopSection}

BOOKING & CONTACT:
Clients book services directly online at ${BRAND.bookingLink} (no intermediary needed).
General contact email: ${BRAND.contactEmail}.
WhatsApp ${BRAND.whatsappNumber} (${BRAND.whatsappLink}) is for personal consultations ONLY — see rule 6.

STRICT RULES:
1. Answer ONLY about these car wash services, the shop products, car care advice related to them, their prices, durations, availability, and booking. For anything off-topic, politely decline and steer the conversation back to the service's offerings.
2. Reply in the user's language. (UI language hint: ${lang === "ar" ? "Arabic" : "English"} — but always follow the language the user actually writes in.)
3. Keep answers to 120 words or fewer.
4. NEVER invent services, prices, durations, or claims. Only use the exact data above.
5. When the user shows booking intent, mention that services can be booked directly online and end your answer with the booking page link: ${BRAND.bookingLink}
6. Offer WhatsApp (${BRAND.whatsappNumber}, ${BRAND.whatsappLink}) ONLY in these two cases — and then do so warmly, as a personal consultation:
   (a) the question requires an individual assessment (specific car condition, special requests, product suitability, etc.);
   (b) the client explicitly asks to speak with the team personally or requests a consultation.
   In ALL other cases (ordinary booking, prices, schedules, general questions), do NOT mention WhatsApp — point to online booking (${BRAND.bookingLink}) or the contact email (${BRAND.contactEmail}) instead.
7. You MAY share the manufacturer's usage directions for the shop products listed above (the USAGE text) when clients ask how to use a product — present them as the manufacturer's recommendations ("according to the manufacturer"). Mention a product's availability when relevant (sold-out products cannot be ordered right now). Do NOT invent directions beyond the USAGE text.`;
}