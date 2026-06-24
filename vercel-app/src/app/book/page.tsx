import Image from "next/image";
import Link from "next/link";
import SessionBuilder from "@/components/booking-calendar/session-builder";
import { SERVICES, type Service } from "@/lib/services";
import {
  getTreatmentsCatalog,
  SEED as TREATMENTS_SEED,
  type Treatment,
} from "@/lib/treatments";

export const metadata = {
  title: "Book — Elite Eco Car Wash",
};

const WHATSAPP_LINK = "https://wa.me/201111147766";
const MAIN_SITE_EN = "https://eliteecocarwash.com/";
const MAIN_SITE_AR = "https://eliteecocarwash.com/ar.html";

type Lang = "en" | "ar";

function withLang(path: string, lang: Lang) {
  if (lang !== "ar") return path;
  return path.includes("?") ? `${path}&lang=ar` : `${path}?lang=ar`;
}

function durationLabel(durations: number[], lang: Lang) {
  const unit = lang === "ar" ? "دقيقة" : "min";
  return `${durations.join(" / ")} ${unit}`;
}

/* ---------- live service list (treatments catalog → Service shape) ---------- */

/** "E£370" — the single-price line style of the static SERVICES. */
function priceLine(egp: number): string {
  return `E£${egp.toLocaleString("en-US")}`;
}

/**
 * Map a catalog treatment onto the Service shape the booking flow uses.
 * While a treatment still matches its static SERVICES entry (the seed state),
 * the static entry is returned as-is — preserving multi-duration toggles and
 * range price lines for the services that have them. Once the owner edits a
 * treatment, it becomes a single-duration service with the new values.
 */
function treatmentToService(t: Treatment): Service {
  const staticService = SERVICES.find((s) => s.slug === t.slug);
  if (
    staticService &&
    staticService.eventTypeId === t.eventTypeId &&
    Math.max(...staticService.durations) === t.durationMinutes &&
    staticService.price.egp === t.priceEgp &&
    staticService.en.title === t.name.en &&
    staticService.ar.title === t.name.ar
  ) {
    return staticService;
  }
  const line = priceLine(t.priceEgp);
  return {
    slug: t.slug,
    eventTypeId: t.eventTypeId,
    en: { title: t.name.en },
    ar: { title: t.name.ar },
    durations: [t.durationMinutes],
    priceLine: { en: line, ar: line },
    price: { egp: t.priceEgp },
  };
}

/**
 * Live services from the treatments catalog; the static SERVICES list is the
 * hardcoded fallback (= SEED) so this page never breaks if Blob is down.
 * Treatments without a linked Cal event type can't take bookings and are
 * filtered out.
 */
async function loadServices(): Promise<Service[]> {
  let treatments: Treatment[];
  try {
    treatments = await getTreatmentsCatalog();
  } catch (error) {
    console.error("[book] Treatments read failed — using built-in seed:", error);
    treatments = [...TREATMENTS_SEED];
  }
  const services = treatments
    .filter((t) => t.active && t.eventTypeId > 0)
    .map(treatmentToService);
  return services.length > 0 ? services : [...SERVICES];
}

function MissingConfigNotice({ lang }: { lang: Lang }) {
  const text =
    lang === "ar"
      ? "قريباً سيكون التقويم متاحاً — احجز فوراً عبر واتساب"
      : "Online calendar coming soon — book instantly on WhatsApp";
  const cta = lang === "ar" ? "افتح واتساب" : "Open WhatsApp";
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-8 rounded-2xl border border-[#0D3B66]/30 bg-[#FFFFFF] px-8 py-16 text-center shadow-sm">
      <p className="font-serif text-2xl leading-snug text-[#0A1A2F]">{text}</p>
      <a
        href={WHATSAPP_LINK}
        className="rounded-full bg-[#0D3B66] px-8 py-3 font-medium text-[#F8FAFC] transition-opacity hover:opacity-90"
      >
        {cta}
      </a>
    </div>
  );
}

function ServicePicker({ lang, services }: { lang: Lang; services: Service[] }) {
  return (
    <div className="mx-auto max-w-2xl">
      <p className="mb-8 text-center text-[#4A5568]">
        {lang === "ar"
          ? "اختر خدمة لرؤية المواعيد المتاحة."
          : "Choose a service to see available times."}
      </p>
      <ul className="flex flex-col gap-3">
        {services.map((service) => (
          <li key={service.slug}>
            <Link
              href={withLang(`/book?service=${service.slug}`, lang)}
              className="group flex items-baseline justify-between gap-4 rounded-xl border border-[#0A1A2F]/10 bg-[#FFFFFF] px-6 py-5 shadow-sm transition-colors hover:border-[#0D3B66]/50"
            >
              <span>
                <span className="block font-serif text-lg text-[#0A1A2F] transition-colors group-hover:text-[#0D3B66]">
                  {service[lang].title}
                </span>
                <span className="mt-1 block text-sm text-[#4A5568]">
                  {service.priceLine[lang]}
                </span>
              </span>
              <span className="shrink-0 text-sm text-[#0D3B66]">
                {durationLabel(service.durations, lang)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; service?: string; duration?: string }>;
}) {
  const {
    lang: langParam,
    service: serviceParam,
    duration: durationParam,
  } = await searchParams;
  const lang: Lang = langParam === "ar" ? "ar" : "en";

  const services = await loadServices();
  const service = serviceParam
    ? services.find((s) => s.slug === serviceParam)
    : undefined;
  const calcomConfigured = Boolean(process.env.CALCOM_API_KEY);
  const mainSite = lang === "ar" ? MAIN_SITE_AR : MAIN_SITE_EN;

  // Resolve requested duration; fall back to the longest available.
  const requestedDuration = durationParam ? parseInt(durationParam, 10) : NaN;
  const duration =
    service && service.durations.includes(requestedDuration)
      ? requestedDuration
      : service
        ? Math.max(...service.durations)
        : 60;

  return (
    <main className="flex flex-1 flex-col px-6 py-12">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-10 text-center">
          <a
            href={mainSite}
            className="mb-6 inline-block"
            aria-label="Elite Eco Car Wash — main site"
          >
            <Image
              src="/logo-white.png"
              alt="Elite Eco Car Wash"
              width={152}
              height={77}
              priority
              className="mx-auto h-auto w-36 opacity-85"
            />
          </a>
          <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[#0D3B66]">
            Elite Eco Car Wash
          </p>
          <h1 className="font-serif text-3xl font-medium text-[#0A1A2F] sm:text-4xl">
            {lang === "ar" ? "احجز موعداً" : "Book a Car Wash"}
          </h1>
          <p className="mt-3 text-sm text-[#4A5568]">
            {lang === "ar"
              ? "نصل إليك أينما كنت في الغونة"
              : "We bring the car wash to you — anywhere in El Gouna."}
          </p>
        </header>

        {!calcomConfigured ? (
          <MissingConfigNotice lang={lang} />
        ) : service ? (
          <SessionBuilder
            serviceSlug={service.slug}
            lang={lang}
            duration={duration}
            services={services}
          />
        ) : (
          <ServicePicker lang={lang} services={services} />
        )}

        <p className="mt-12 text-center text-sm text-[#4A5568]">
          <a href={mainSite} className="underline-offset-4 hover:underline">
            ← Elite Eco Car Wash
          </a>
        </p>
      </div>
    </main>
  );
}