"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CalBooking } from "@/lib/admin/cal";
import { COMBINED_SESSION, SERVICES } from "@/lib/services";

const PUBLIC_BOOKING_BASE = "https://book.eliteecocarwash.com/book";
const CAIRO_TZ = "Africa/Cairo";

/* ---------- helpers ---------- */

function formatCairo(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CAIRO_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** Calendar date ("YYYY-MM-DD") of an ISO instant in Cairo time. */
function cairoDateOf(iso: string | Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CAIRO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

/** Wall-clock time ("HH:mm") of an ISO instant in Cairo time. */
function formatCairoTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CAIRO_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** Shift a "YYYY-MM-DD" date by whole days (calendar arithmetic, UTC-safe). */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Cal rejects reschedules to anything that isn't a genuinely free slot
 * ("User either already has booking at this time or is not available").
 * The move UI only offers fetched slots, so a residual rejection means the
 * slot was taken between fetch and submit — translate it for the team.
 */
function mapMoveError(message: string): string {
  return /already has booking|not available|no longer available|no_available/i.test(
    message
  )
    ? "That time was just taken or is no longer available — pick another slot."
    : message;
}

function serviceForBooking(booking: CalBooking) {
  return SERVICES.find((s) => s.eventTypeId === booking.eventTypeId);
}

/**
 * Multi-duration event types need an explicit `duration` on the slots query
 * (same rule the public /book page applies via session-builder). Unknown
 * event types (not in SERVICES, not the combined session) also send the
 * booking's duration — required if they happen to be multi-duration,
 * harmless for single-duration ones.
 */
function needsExplicitDuration(booking: CalBooking): boolean {
  if (booking.eventTypeId === COMBINED_SESSION.eventTypeId) return true;
  const service = serviceForBooking(booking);
  if (!service) return true;
  return service.durations.length > 1;
}

function bookingLink(booking: CalBooking): string {
  const slug = serviceForBooking(booking)?.slug ?? booking.eventType?.slug;
  // Combined sessions have no public per-service page — link to the picker.
  return slug && slug !== COMBINED_SESSION.slug
    ? `${PUBLIC_BOOKING_BASE}?service=${slug}`
    : PUBLIC_BOOKING_BASE;
}

function serviceTitle(booking: CalBooking): string {
  return serviceForBooking(booking)?.en.title ?? booking.title;
}

/** Client notes (incl. the "Treatments: …" line for combined sessions). */
function bookingNotes(booking: CalBooking): string | null {
  const notes = booking.bookingFieldsResponses?.notes;
  if (typeof notes !== "string") return null;
  const trimmed = notes.trim();
  if (!trimmed || trimmed === "No additional notes provided") return null;
  return trimmed;
}

function suggestTemplate(booking: CalBooking): string {
  return (
    "I can't make this time. Could we try one of these instead?\n" +
    "• \n" +
    "• \n" +
    `Book here: ${bookingLink(booking)}`
  );
}

/* ---------- small UI pieces ---------- */

function StatusChip({ status }: { status: string }) {
  const styles =
    status === "pending"
      ? "bg-[#0D3B66]/15 text-[#1A5F9E]"
      : status === "accepted"
        ? "bg-[#6B7A4F]/15 text-[#55633D]"
        : "bg-[#0A1A2F]/10 text-[#0A1A2F]";
  const label = status === "accepted" ? "confirmed" : status;
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-medium capitalize ${styles}`}
    >
      {label}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#0A1A2F]/15 bg-[#FFFFFF]/60 px-6 py-8 text-center text-sm text-[#4A5568]">
      {text}
    </div>
  );
}

const buttonBase =
  "rounded-full px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-50";

/* ---------- pending booking card ---------- */

type Mode = "decline" | "suggest" | "move" | null;

function PendingCard({
  booking,
  adminKey,
  onChanged,
}: {
  booking: CalBooking;
  adminKey: string;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [note, setNote] = useState("");
  const [moveDate, setMoveDate] = useState(""); // "YYYY-MM-DD" (Cairo day)
  const [moveSlots, setMoveSlots] = useState<string[]>([]); // ISO starts
  const [moveSlot, setMoveSlot] = useState(""); // selected ISO start
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /**
   * Monotonic id for slot fetches. Two quick date changes race: without this
   * guard the slower (older) response lands last and silently fills the
   * dropdown with the WRONG day's slots (options show time only). Each
   * loadSlots call takes a fresh id and bails before every setState if a
   * newer call has started since.
   */
  const slotsReqId = useRef(0);

  async function callAction(
    action: "confirm" | "decline" | "reschedule",
    body?: Record<string, unknown>,
    doneLabel?: string,
    mapError?: (message: string) => string
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/bookings/${booking.uid}/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const message =
          (payload && (payload.error?.message || payload.error)) ||
          `Request failed (${res.status})`;
        const raw =
          typeof message === "string" ? message : `Request failed (${res.status})`;
        setError(mapError ? mapError(raw) : raw);
        return false;
      }
      setDone(doneLabel ?? "Done");
      onChanged();
      return true;
    } catch {
      setError("Network error — please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Free Cal slots for this booking's event type on a Cairo calendar day. */
  async function loadSlots(date: string) {
    const reqId = ++slotsReqId.current;
    setSlotsLoading(true);
    setSlotsError(null);
    setMoveSlots([]);
    setMoveSlot("");
    try {
      // Fetch a ±1-day window — Cal buckets slots by UTC-ish dates, so the
      // Cairo day can spill into neighbouring buckets. Filter to the exact
      // Cairo day afterwards (same approach as the public /book page).
      const params = new URLSearchParams({
        eventTypeId: String(booking.eventTypeId),
        dateFrom: shiftDate(date, -1),
        dateTo: shiftDate(date, 1),
      });
      if (needsExplicitDuration(booking)) {
        params.set("duration", String(booking.duration));
      }
      const res = await fetch(`/api/admin/slots?${params}`, {
        headers: { "x-admin-key": adminKey },
      });
      if (reqId !== slotsReqId.current) return; // superseded by a newer call
      if (!res.ok) {
        setSlotsError("Couldn't load available times — please try again.");
        return;
      }
      const data = (await res.json()) as Record<string, { start: string }[]>;
      if (reqId !== slotsReqId.current) return; // superseded by a newer call
      const starts =
        data && typeof data === "object"
          ? Object.values(data)
              .flat()
              .map((slot) => slot.start)
              .filter((startIso) => cairoDateOf(startIso) === date)
              .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
          : [];
      setMoveSlots(starts);
    } catch {
      if (reqId !== slotsReqId.current) return; // superseded by a newer call
      setSlotsError("Couldn't load available times — please try again.");
    } finally {
      // Only the newest request controls the loading indicator.
      if (reqId === slotsReqId.current) setSlotsLoading(false);
    }
  }

  async function submitMove() {
    if (!moveSlot) return;
    const ok = await callAction(
      "reschedule",
      { start: moveSlot, reason: "Moved by admin" },
      "Booking moved to the new time.",
      mapMoveError
    );
    if (!ok && moveDate) {
      // The slot list is stale (likely just taken) — refresh it.
      setMoveSlot("");
      void loadSlots(moveDate);
    }
  }

  function openMode(next: Exclude<Mode, null>) {
    setError(null);
    setMode(next);
    if (next === "suggest") setNote(suggestTemplate(booking));
    if (next === "decline") setNote("");
    if (next === "move") {
      slotsReqId.current++; // invalidate any in-flight slot fetch
      setMoveDate("");
      setMoveSlots([]);
      setMoveSlot("");
      setSlotsError(null);
      setSlotsLoading(false);
    }
  }

  const attendee = booking.attendees[0];

  if (done) {
    return (
      <article className="rounded-2xl border border-[#0A1A2F]/10 bg-[#FFFFFF] px-5 py-4 shadow-sm">
        <p className="text-sm text-[#55633D]">{done}</p>
      </article>
    );
  }

  return (
    <article className="rounded-2xl border border-[#0A1A2F]/10 bg-[#FFFFFF] px-5 py-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-serif text-xl text-[#0A1A2F]">
            {serviceTitle(booking)}
          </h3>
          <p className="mt-1 text-sm text-[#0A1A2F]">
            {attendee?.name}
            {attendee?.email ? (
              <span className="text-[#4A5568]"> · {attendee.email}</span>
            ) : null}
          </p>
          <p className="mt-1 text-sm font-medium text-[#1A5F9E]">
            {formatCairo(booking.start)} · {booking.duration} min
          </p>
          {bookingNotes(booking) && (
            <p className="mt-2 whitespace-pre-line rounded-xl bg-[#0A1A2F]/5 px-3 py-2 text-sm text-[#0A1A2F]">
              {bookingNotes(booking)}
            </p>
          )}
        </div>
        <StatusChip status={booking.status} />
      </div>

      {mode === null && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => callAction("confirm", undefined, "Booking confirmed.")}
            className={`${buttonBase} bg-[#1A5F9E] text-[#F8FAFC] hover:opacity-90`}
          >
            {busy ? "Working…" : "Confirm"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => openMode("decline")}
            className={`${buttonBase} border border-[#B91C1C]/40 text-[#B91C1C] hover:bg-[#B91C1C]/5`}
          >
            Decline with note
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => openMode("suggest")}
            className={`${buttonBase} border border-[#1A5F9E]/40 text-[#1A5F9E] hover:bg-[#1A5F9E]/5`}
          >
            Suggest reschedule
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => openMode("move")}
            className={`${buttonBase} border border-[#0A1A2F]/20 text-[#0A1A2F] hover:bg-[#0A1A2F]/5`}
          >
            Move to new time
          </button>
        </div>
      )}

      {(mode === "decline" || mode === "suggest") && (
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-medium text-[#0A1A2F]">
            {mode === "decline"
              ? "Note to the client (required — sent in the decline email)"
              : "Reschedule invitation (sent in the decline email — add your suggested times)"}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={mode === "suggest" ? 6 : 4}
              className="mt-2 w-full rounded-xl border border-[#0A1A2F]/20 bg-white px-3 py-2 text-sm text-[#0A1A2F] focus:border-[#1A5F9E] focus:outline-none"
              placeholder={
                mode === "decline" ? "e.g. I'm fully booked that day…" : undefined
              }
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || note.trim().length === 0}
              onClick={() =>
                callAction(
                  "decline",
                  { reason: note.trim() },
                  mode === "suggest"
                    ? "Declined with reschedule invitation."
                    : "Declined — your note was sent to the client."
                )
              }
              className={`${buttonBase} bg-[#B91C1C] text-[#F8FAFC] hover:opacity-90`}
            >
              {busy
                ? "Working…"
                : mode === "suggest"
                  ? "Decline & send invitation"
                  : "Decline & send note"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode(null)}
              className={`${buttonBase} text-[#4A5568] hover:bg-[#0A1A2F]/5`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "move" && (
        <div className="mt-4 space-y-3">
          <p className="rounded-xl bg-[#0D3B66]/10 px-3 py-2 text-xs text-[#1A5F9E]">
            This rebooks the appointment to the new time immediately — the
            client is notified by Cal.com, not asked.
          </p>
          <label className="block text-sm font-medium text-[#0A1A2F]">
            New date (Cairo time)
            <input
              type="date"
              value={moveDate}
              min={cairoDateOf(new Date())}
              disabled={busy}
              onChange={(e) => {
                const date = e.target.value;
                setMoveDate(date);
                if (date) void loadSlots(date);
                else {
                  slotsReqId.current++; // invalidate any in-flight slot fetch
                  setMoveSlots([]);
                  setMoveSlot("");
                  setSlotsError(null);
                  setSlotsLoading(false);
                }
              }}
              className="mt-2 w-full rounded-xl border border-[#0A1A2F]/20 bg-white px-3 py-2 text-sm text-[#0A1A2F] focus:border-[#1A5F9E] focus:outline-none"
            />
          </label>
          {moveDate &&
            (slotsLoading ? (
              <p className="text-sm text-[#4A5568]">Loading available times…</p>
            ) : slotsError ? (
              <p className="text-sm text-[#B91C1C]">{slotsError}</p>
            ) : moveSlots.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[#0A1A2F]/15 bg-[#FFFFFF]/60 px-3 py-2 text-sm text-[#4A5568]">
                No free times this day — try another date.
              </p>
            ) : (
              <label className="block text-sm font-medium text-[#0A1A2F]">
                New start time (Cairo time) — only free slots are listed
                <select
                  value={moveSlot}
                  onChange={(e) => setMoveSlot(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-[#0A1A2F]/20 bg-white px-3 py-2 text-sm text-[#0A1A2F] focus:border-[#1A5F9E] focus:outline-none"
                >
                  <option value="">Select a time…</option>
                  {moveSlots.map((iso) => (
                    <option key={iso} value={iso}>
                      {formatCairoTime(iso)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !moveSlot}
              onClick={() => void submitMove()}
              className={`${buttonBase} bg-[#1A5F9E] text-[#F8FAFC] hover:opacity-90`}
            >
              {busy ? "Working…" : "Move booking now"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode(null)}
              className={`${buttonBase} text-[#4A5568] hover:bg-[#0A1A2F]/5`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-[#B91C1C]">{error}</p>}
    </article>
  );
}

/* ---------- confirmed booking card ---------- */

function ConfirmedCard({ booking }: { booking: CalBooking }) {
  const attendee = booking.attendees[0];
  return (
    <article className="rounded-2xl border border-[#0A1A2F]/10 bg-[#FFFFFF] px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-serif text-lg text-[#0A1A2F]">
            {serviceTitle(booking)}
          </h3>
          <p className="mt-1 text-sm text-[#0A1A2F]">
            {attendee?.name}
            {attendee?.email ? (
              <span className="text-[#4A5568]"> · {attendee.email}</span>
            ) : null}
          </p>
          <p className="mt-1 text-sm text-[#4A5568]">
            {formatCairo(booking.start)} · {booking.duration} min
          </p>
          {bookingNotes(booking) && (
            <p className="mt-2 whitespace-pre-line rounded-xl bg-[#0A1A2F]/5 px-3 py-2 text-sm text-[#0A1A2F]">
              {bookingNotes(booking)}
            </p>
          )}
        </div>
        <StatusChip status={booking.status} />
      </div>
    </article>
  );
}

/* ---------- inbox ---------- */

export default function AdminInbox({
  pending,
  confirmed,
  adminKey,
}: {
  pending: CalBooking[];
  confirmed: CalBooking[];
  adminKey: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const refresh = () => startTransition(() => router.refresh());

  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-4 font-serif text-2xl text-[#0A1A2F]">
          Pending requests
          {pending.length > 0 && (
            <span className="ml-2 align-middle text-sm font-sans text-[#1A5F9E]">
              {pending.length}
            </span>
          )}
        </h2>
        {pending.length === 0 ? (
          <EmptyState text="No pending requests — all caught up." />
        ) : (
          <div className="space-y-4">
            {pending.map((b) => (
              <PendingCard
                key={b.uid}
                booking={b}
                adminKey={adminKey}
                onChanged={refresh}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 font-serif text-2xl text-[#0A1A2F]">
          Upcoming confirmed
        </h2>
        {confirmed.length === 0 ? (
          <EmptyState text="No upcoming confirmed bookings yet." />
        ) : (
          <div className="space-y-4">
            {confirmed.map((b) => (
              <ConfirmedCard key={b.uid} booking={b} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
