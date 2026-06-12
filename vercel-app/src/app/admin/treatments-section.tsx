"use client";

import { useState } from "react";
import type { Treatment } from "@/lib/treatments";

/**
 * Treatments manager — Victoria's service menu CRUD inside /admin,
 * mirroring the products section UX (list, inline edit, add form,
 * active toggle).
 *
 * Saves report Cal.com sync status: name/duration/visibility changes are
 * best-effort pushed to the linked Cal event type; when that fails the save
 * still succeeds and a notice asks Victoria to update Cal manually.
 * Prices live only in this catalog — they never touch Cal.
 */

function authHeaders(adminKey: string): Record<string, string> {
  return adminKey ? { "x-admin-key": adminKey } : {};
}

async function readError(res: Response): Promise<string> {
  const payload = (await res.json().catch(() => null)) as {
    error?: string;
    fields?: Record<string, string>;
  } | null;
  if (payload?.fields) {
    const first = Object.values(payload.fields)[0];
    if (first) return first;
  }
  if (payload?.error) return payload.error;
  return `Request failed (${res.status})`;
}

interface SaveResponse {
  treatment: Treatment;
  cal?: { synced: boolean; error?: string };
}

function calNotice(cal: SaveResponse["cal"]): string | null {
  if (!cal || cal.synced) return null;
  return "Saved here, but the Cal.com event type couldn't be updated — please adjust it in Cal manually.";
}

/* ---------- shared styles (same palette as the products section) ---------- */

const inputCls =
  "w-full rounded-xl border border-[#3A332C]/15 bg-white px-3 py-2 text-sm text-[#3A332C] outline-none focus:border-[#8A5238]";
const labelCls =
  "mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-[#847866]";
const buttonBase =
  "rounded-full px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-50";
const primaryBtn = `${buttonBase} bg-[#8A5238] text-[#FDF9F3] hover:opacity-90`;
const subtleBtn = `${buttonBase} border border-[#3A332C]/15 bg-[#FFFDF9] text-[#3A332C] hover:bg-[#F4EFE7]`;

function statusChip(t: Treatment): { label: string; cls: string } {
  return t.active
    ? { label: "Active", cls: "bg-[#6B7A4F]/15 text-[#55633D]" }
    : { label: "Hidden", cls: "bg-[#3A332C]/10 text-[#3A332C]" };
}

/* ---------- treatment form (add / edit) ---------- */

interface FormState {
  enName: string;
  ruName: string;
  enDesc: string;
  ruDesc: string;
  duration: string;
  priceEgp: string;
  priceRub: string;
  active: boolean;
}

function toFormState(t: Treatment | null): FormState {
  return {
    enName: t?.name.en ?? "",
    ruName: t?.name.ru ?? "",
    enDesc: t?.description.en ?? "",
    ruDesc: t?.description.ru ?? "",
    duration: t ? String(t.durationMinutes) : "",
    priceEgp: t ? String(t.priceEgp) : "",
    priceRub: t ? String(t.priceRub) : "",
    active: t?.active ?? true,
  };
}

function TreatmentForm({
  treatment,
  adminKey,
  onSaved,
  onCancel,
}: {
  treatment: Treatment | null; // null = create
  adminKey: string;
  onSaved: (saved: Treatment, calMessage: string | null) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => toFormState(treatment));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<FormState>) =>
    setForm((f) => ({ ...f, ...patch }));

  async function submit() {
    setError(null);
    const duration = Number(form.duration);
    const priceEgp = Number(form.priceEgp);
    const priceRub = Number(form.priceRub);
    if (!form.enName.trim() || !form.ruName.trim()) {
      setError("Both EN and RU names are required.");
      return;
    }
    if (!Number.isInteger(duration) || duration < 5 || form.duration === "") {
      setError("Duration must be a whole number of minutes (5 or more).");
      return;
    }
    if (!Number.isInteger(priceEgp) || priceEgp < 0 || form.priceEgp === "") {
      setError("Price (EGP) must be a whole number.");
      return;
    }
    if (!Number.isInteger(priceRub) || priceRub < 0 || form.priceRub === "") {
      setError("Price (RUB) must be a whole number.");
      return;
    }

    const body = {
      name: { en: form.enName.trim(), ru: form.ruName.trim() },
      description: { en: form.enDesc.trim(), ru: form.ruDesc.trim() },
      durationMinutes: duration,
      priceEgp,
      priceRub,
      active: form.active,
    };

    setBusy(true);
    try {
      const res = await fetch(
        treatment
          ? `/api/admin/treatments/${encodeURIComponent(treatment.slug)}`
          : "/api/admin/treatments",
        {
          method: treatment ? "PUT" : "POST",
          headers: { "Content-Type": "application/json", ...authHeaders(adminKey) },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const payload = (await res.json()) as SaveResponse;
      onSaved(payload.treatment, calNotice(payload.cal));
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[#8A5238]/25 bg-[#FFFDF9] px-5 py-5 shadow-sm">
      <h3 className="font-serif text-xl text-[#3A332C]">
        {treatment ? `Edit — ${treatment.name.en}` : "Add treatment"}
      </h3>
      {treatment ? (
        <p className="mt-1 text-xs text-[#847866]">
          Slug: <code>{treatment.slug}</code> (permanent)
          {treatment.eventTypeId > 0 ? (
            <>
              {" "}
              · Cal event type <code>{treatment.eventTypeId}</code>
            </>
          ) : (
            " · no linked Cal event type"
          )}
        </p>
      ) : (
        <p className="mt-1 text-xs text-[#847866]">
          A Cal.com event type (with Victoria&apos;s confirmation required) is
          created automatically.
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Name (EN)</label>
            <input className={inputCls} value={form.enName} onChange={(e) => set({ enName: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Description (EN)</label>
            <textarea
              className={inputCls}
              rows={2}
              value={form.enDesc}
              placeholder="Plastic / Myofascial / Buccal"
              onChange={(e) => set({ enDesc: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Name (RU)</label>
            <input className={inputCls} value={form.ruName} onChange={(e) => set({ ruName: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Description (RU)</label>
            <textarea
              className={inputCls}
              rows={2}
              value={form.ruDesc}
              placeholder="пластический / миофасциальный / буккальный"
              onChange={(e) => set({ ruDesc: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className={labelCls}>Duration (minutes)</label>
          <input className={inputCls} inputMode="numeric" value={form.duration} onChange={(e) => set({ duration: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>Price (EGP)</label>
          <input className={inputCls} inputMode="numeric" value={form.priceEgp} onChange={(e) => set({ priceEgp: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>Price (RUB)</label>
          <input className={inputCls} inputMode="numeric" value={form.priceRub} onChange={(e) => set({ priceRub: e.target.value })} />
        </div>
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm text-[#3A332C]">
        <input
          type="checkbox"
          checked={form.active}
          onChange={(e) => set({ active: e.target.checked })}
          className="h-4 w-4 accent-[#8A5238]"
        />
        Visible on the site and bookable
      </label>

      {error && <p className="mt-3 text-sm text-[#B5483A]">{error}</p>}

      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void submit()} className={primaryBtn}>
          {busy ? "Saving…" : treatment ? "Save changes" : "Create treatment"}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={subtleBtn}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ---------- treatment row ---------- */

function TreatmentRow({
  treatment,
  adminKey,
  onUpdated,
  onEdit,
}: {
  treatment: Treatment;
  adminKey: string;
  onUpdated: (t: Treatment, calMessage: string | null) => void;
  onEdit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleActive() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/treatments/${encodeURIComponent(treatment.slug)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders(adminKey) },
          body: JSON.stringify({ active: !treatment.active }),
        }
      );
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const payload = (await res.json()) as SaveResponse;
      onUpdated(payload.treatment, calNotice(payload.cal));
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const chip = statusChip(treatment);

  return (
    <article className="rounded-2xl border border-[#3A332C]/10 bg-[#FFFDF9] px-4 py-4 shadow-sm sm:px-5">
      <div className="flex items-start gap-3">
        <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-[#E0D8CE] text-[#3A332C]">
          <span className="font-serif text-lg leading-none">
            {treatment.durationMinutes}
          </span>
          <span className="mt-0.5 text-[10px] uppercase tracking-[0.1em] text-[#847866]">
            min
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="font-serif text-lg leading-snug text-[#3A332C]">
              {treatment.name.en}
            </h3>
            <span
              className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${chip.cls}`}
            >
              {chip.label}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-[#847866]">{treatment.name.ru}</p>
          <p className="mt-0.5 text-sm text-[#847866]">
            {treatment.priceEgp.toLocaleString("en-EG")} EGP ·{" "}
            {treatment.priceRub.toLocaleString("ru-RU")} RUB
            {treatment.eventTypeId > 0 ? (
              <span className="text-xs"> · Cal #{treatment.eventTypeId}</span>
            ) : (
              <span className="text-xs text-[#B5483A]"> · no Cal event type</span>
            )}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={onEdit} className={subtleBtn}>
          Edit
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void toggleActive()}
          className={subtleBtn}
        >
          {treatment.active ? "Hide from site" : "Show on site"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-[#B5483A]">{error}</p>}
    </article>
  );
}

/* ---------- section ---------- */

export default function TreatmentsSection({
  initialTreatments,
  adminKey,
  loadError,
}: {
  initialTreatments: Treatment[];
  adminKey: string;
  loadError: string | null;
}) {
  const [treatments, setTreatments] = useState<Treatment[]>(initialTreatments);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [calMessage, setCalMessage] = useState<string | null>(null);

  function handleUpdated(updated: Treatment, message: string | null) {
    setTreatments((list) =>
      list.map((t) => (t.slug === updated.slug ? updated : t))
    );
    setEditingSlug(null);
    setCalMessage(message);
  }

  function handleCreated(created: Treatment, message: string | null) {
    setTreatments((list) => [...list, created]);
    setAdding(false);
    setCalMessage(message);
  }

  const editing = editingSlug
    ? treatments.find((t) => t.slug === editingSlug) ?? null
    : null;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-2xl text-[#3A332C]">
          Treatments
          {treatments.length > 0 && (
            <span className="ml-2 align-middle font-sans text-sm text-[#8A5238]">
              {treatments.length}
            </span>
          )}
        </h2>
        {!adding && !editing && (
          <button type="button" onClick={() => setAdding(true)} className={primaryBtn}>
            Add treatment
          </button>
        )}
      </div>

      {calMessage && (
        <div className="mb-4 rounded-2xl border border-[#B5483A]/30 bg-[#FFFDF9] px-5 py-3 text-sm text-[#B5483A]">
          {calMessage}
        </div>
      )}

      {loadError ? (
        <div className="rounded-2xl border border-[#B5483A]/30 bg-[#FFFDF9] px-6 py-5 text-sm text-[#B5483A]">
          {loadError}
        </div>
      ) : (
        <div className="space-y-4">
          {adding && (
            <TreatmentForm
              treatment={null}
              adminKey={adminKey}
              onSaved={handleCreated}
              onCancel={() => setAdding(false)}
            />
          )}
          {editing && (
            <TreatmentForm
              key={editing.slug}
              treatment={editing}
              adminKey={adminKey}
              onSaved={handleUpdated}
              onCancel={() => setEditingSlug(null)}
            />
          )}
          {treatments.length === 0 && !adding ? (
            <div className="rounded-2xl border border-dashed border-[#3A332C]/15 bg-[#FFFDF9]/60 px-6 py-8 text-center text-sm text-[#847866]">
              No treatments yet — add the first one.
            </div>
          ) : (
            treatments.map((treatment) => (
              <TreatmentRow
                key={treatment.slug}
                treatment={treatment}
                adminKey={adminKey}
                onUpdated={handleUpdated}
                onEdit={() => {
                  setAdding(false);
                  setEditingSlug(treatment.slug);
                }}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}
