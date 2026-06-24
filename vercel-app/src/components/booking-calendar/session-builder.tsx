"use client";

/**
 * Multi-treatment session builder for /book?service=<slug>.
 *
 * - 1 treatment selected → exact current behaviour: the service's own Cal.com
 *   event type, duration toggle for multi-duration services.
 * - 2+ treatments → slots and booking go to the shared COMBINED_SESSION event
 *   type with duration = sum of each chosen service's LONGEST duration, and a
 *   "Treatments: …" line is appended to the booking notes for the team.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import BookingWidget from "@/components/booking-calendar/booking-widget";
import {
  COMBINED_DURATION_OPTIONS,
  COMBINED_SESSION,
  SERVICES,
  longestDuration,
  type Service,
} from "@/lib/services";

type Lang = "en" | "ar";

const STRINGS = {
  en: {
    addTreatment: "Add another treatment to this session",
    pickerHeading: "Add treatments",
    done: "Done",
    minTotal: "min total",
    min: "min",
    overLimit: "Please contact us for sessions over 4 hours.",
    maxCount: "Up to 4 treatments per session.",
    removeTreatment: "Remove treatment",
    changeTreatment: "← Change treatment",
    calendarTitle: "Choose a time that suits you",
    calendarDescription:
      "the team will confirm your appointment after you send the request.",
  },
  ru: {
    addTreatment: "Добавить ещё одну процедуру к сессии",
    pickerHeading: "Добавить процедуры",
    done: "Готово",
    minTotal: "мин всего",
    min: "мин",
    overLimit:
      "Для сессий длительностью более 4 часов, пожалуйста, свяжитесь с нами.",
    maxCount: "Не более 4 процедур за одну сессию.",
    removeTreatment: "Убрать процедуру",
    changeTreatment: "← Выбрать другую процедуру",
    calendarTitle: "Выберите удобное время",
    calendarDescription: "Виктория подтвердит вашу запись после отправки заявки.",
  },
} as const;

function withLang(path: string, lang: Lang) {
  if (lang !== "ar") return path;
  return path.includes("?") ? `${path}&lang=ru` : `${path}?lang=ru`;
}

function durationLabel(durations: number[], lang: Lang) {
  const unit = lang === "ar" ? "мин" : "min";
  return `${durations.join(" / ")} ${unit}`;
}

/** "E£3,700" */
function formatEgp(n: number) {
  return `E£${n.toLocaleString("en-US")}`;
}

/** "5 200 ₽" (regular spaces as thousands separators) */

interface SessionBuilderProps {
  serviceSlug: string;
  /** Resolved single-service duration from the URL (longest by default). */
  duration: number;
  lang: Lang;
  /**
   * The live service list (built from the treatments catalog by /book).
   * Defaults to the static SERVICES so the builder never breaks standalone.
   */
  services?: Service[];
}

export default function SessionBuilder({
  serviceSlug,
  duration,
  lang,
  services = SERVICES,
}: SessionBuilderProps) {
  const t = STRINGS[lang];
  const [extraSlugs, setExtraSlugs] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const baseService = services.find((s) => s.slug === serviceSlug);

  const extras = useMemo(
    () =>
      extraSlugs
        .map((slug) => services.find((s) => s.slug === slug))
        .filter((s): s is Service => Boolean(s)),
    [extraSlugs, services]
  );

  if (!baseService) return null;

  const isMulti = extras.length > 0;
  const selected: Service[] = [baseService, ...extras];

  // Combined sessions always use the longest duration of every treatment.
  const totalMinutes = selected.reduce((sum, s) => sum + longestDuration(s), 0);
  const totalEgp = selected.reduce((sum, s) => sum + s.price.egp, 0);
  
  // 4 treatments max per session (matches the Cal event type's options set).
  const atMaxTreatments = selected.length >= 4;

  const canAdd = (candidate: Service) =>
    !atMaxTreatments &&
    COMBINED_DURATION_OPTIONS.includes(
      // When adding the first extra, the base switches to its longest duration.
      (isMulti ? totalMinutes : longestDuration(baseService)) +
        longestDuration(candidate)
    );

  const toggleExtra = (slug: string) => {
    setExtraSlugs((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  };

  const candidates = services.filter((s) => s.slug !== baseService.slug);
  const anyBlocked = candidates.some(
    (s) => !extraSlugs.includes(s.slug) && !canAdd(s)
  );

  const multiDuration = baseService.durations.length > 1;
  const unit = t.min;

  // Treatment list for the team — appended to the booking notes (EN titles so
  // the line is consistent in the admin inbox and emails regardless of lang).
  const treatmentsNote = isMulti
    ? `Treatments: ${selected
        .map((s) => `${s.en.title} (${longestDuration(s)})`)
        .join(" + ")} — total ${totalMinutes} min`
    : undefined;

  const summaryLine = `${selected
    .map((s) => `${s[lang].title} ${longestDuration(s)}`)
    .join(" + ")} — ${totalMinutes} ${t.minTotal} · ${formatEgp(totalEgp)} `;

  return (
    <div>
      <div className="mb-8 text-center">
        <h2 className="font-serif text-2xl text-[#0A1A2F]">
          {baseService[lang].title}
        </h2>
        <p className="mt-2 text-sm text-[#4A5568]">
          {baseService.priceLine[lang]} ·{" "}
          {durationLabel(baseService.durations, lang)}
        </p>

        {/* Duration toggle — single-treatment mode only; combined sessions
            always use each treatment's longest duration. */}
        {multiDuration && !isMulti && (
          <div className="mt-4 inline-flex gap-2 rounded-full border border-[#0A1A2F]/10 bg-[#FFFFFF] p-1">
            {baseService.durations.map((d) => (
              <Link
                key={d}
                href={withLang(
                  `/book?service=${baseService.slug}&duration=${d}`,
                  lang
                )}
                className={
                  d === duration
                    ? "rounded-full bg-[#0D3B66] px-4 py-1.5 text-sm font-medium text-[#F8FAFC]"
                    : "rounded-full px-4 py-1.5 text-sm text-[#4A5568] transition-colors hover:text-[#0D3B66]"
                }
              >
                {d} {unit}
              </Link>
            ))}
          </div>
        )}

        {/* Add-another-treatment affordance */}
        <div className="mt-5">
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            aria-expanded={pickerOpen}
            className="inline-flex items-center gap-2 rounded-full border border-[#0D3B66]/40 bg-[#FFFFFF] px-5 py-2 text-sm text-[#0D3B66] transition-colors hover:border-[#0D3B66] hover:bg-[#0D3B66]/5"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            {t.addTreatment}
          </button>
        </div>

        {pickerOpen && (
          <div className="mx-auto mt-4 max-w-xl rounded-2xl border border-[#0A1A2F]/10 bg-[#FFFFFF] p-4 text-left shadow-sm">
            <p className="mb-3 px-1 text-xs font-medium uppercase tracking-[0.15em] text-[#4A5568]">
              {t.pickerHeading}
            </p>
            <ul className="flex flex-col gap-1">
              {candidates.map((service) => {
                const checked = extraSlugs.includes(service.slug);
                const blocked = !checked && !canAdd(service);
                return (
                  <li key={service.slug}>
                    <label
                      className={`flex items-baseline gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                        blocked
                          ? "cursor-not-allowed opacity-40"
                          : "cursor-pointer hover:bg-[#0D3B66]/5"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={blocked}
                        onChange={() => toggleExtra(service.slug)}
                        className="relative top-0.5 size-4 shrink-0 cursor-pointer accent-[#0D3B66] disabled:cursor-not-allowed"
                      />
                      <span className="flex-1">
                        <span className="block text-[15px] text-[#0A1A2F]">
                          {service[lang].title}
                        </span>
                        <span className="mt-0.5 block text-xs text-[#4A5568]">
                          {service.priceLine[lang]}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm text-[#0D3B66]">
                        {longestDuration(service)} {unit}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {anyBlocked && (
              <p className="mt-3 rounded-xl bg-[#0D3B66]/10 px-3 py-2 text-sm text-[#1A5F9E]">
                {atMaxTreatments ? t.maxCount : t.overLimit}
              </p>
            )}
            <div className="mt-3 text-right">
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="rounded-full bg-[#0D3B66] px-5 py-1.5 text-sm font-medium text-[#F8FAFC] transition-opacity hover:opacity-90"
              >
                {t.done}
              </button>
            </div>
          </div>
        )}

        {/* Session summary — chips + totals */}
        {isMulti && (
          <div className="mx-auto mt-4 max-w-xl">
            <div className="flex flex-wrap items-center justify-center gap-2">
              {selected.map((service, i) => (
                <span
                  key={service.slug}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#0D3B66]/30 bg-[#0D3B66]/10 py-1.5 pl-3.5 pr-2.5 text-sm text-[#1A5F9E]"
                >
                  {service[lang].title} {longestDuration(service)}
                  {i === 0 ? (
                    <span className="w-1" aria-hidden="true" />
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleExtra(service.slug)}
                      aria-label={`${t.removeTreatment}: ${service[lang].title}`}
                      className="rounded-full p-0.5 transition-colors hover:bg-[#0D3B66]/20"
                    >
                      <X aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              ))}
            </div>
            <p className="mt-3 text-sm font-medium text-[#0A1A2F]">
              {summaryLine}
            </p>
          </div>
        )}

        <p className="mt-4 text-sm">
          <Link
            href={withLang("/book", lang)}
            className="text-[#0D3B66] underline-offset-4 hover:underline"
          >
            {t.changeTreatment}
          </Link>
        </p>
      </div>

      <BookingWidget
        // Reset widget state (selected slot/form) whenever the session changes.
        key={isMulti ? `combined-${totalMinutes}-${extraSlugs.join("+")}` : `single-${duration}`}
        eventTypeId={String(
          isMulti ? COMBINED_SESSION.eventTypeId : baseService.eventTypeId
        )}
        eventLength={isMulti ? totalMinutes : duration}
        multiDuration={isMulti ? true : multiDuration}
        treatmentsNote={treatmentsNote}
        lang={lang}
        title={t.calendarTitle}
        description={t.calendarDescription}
        showHeader
      />
    </div>
  );
}
