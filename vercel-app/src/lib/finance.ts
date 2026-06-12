import { del, get, list, put } from "@vercel/blob";

/**
 * Manual finance ledger on Vercel Blob (private store `vv-orders`),
 * mirroring the SHOP ORDERS model in @/lib/orders.
 *
 * Layout: ONE BLOB PER ENTRY at `finance/entries/<id>.json`. This is the
 * orders model, chosen deliberately over a single read-modify-write document:
 * because money is the wrong risk class for last-write-wins, two near-
 * simultaneous adds must NEVER drop an entry. With one document, concurrent
 * adds each read the array, append, and overwrite — the slower writer clobbers
 * the faster writer's entry. With one blob per entry, each add writes its OWN
 * blob (distinct id) so no add can ever lose another.
 *
 * MIGRATION / dual-layout tolerance: a LEGACY single-document layout existed
 * at `finance/ledger.json` (an array of entries). This is NOT deployed to prod
 * yet, so a clean cutover is acceptable — but `listLedger` stays tolerant of
 * BOTH layouts so any stray legacy document is never silently lost: it merges
 * the per-entry blobs under `finance/entries/` with a legacy `ledger.json`
 * array if one exists (the per-entry layout wins on id conflict). add/update/
 * remove operate on the single entry blob; update/remove fall back to the
 * legacy array only when the id is found there (so legacy rows stay editable).
 *
 * SCOPE — the ledger holds MANUAL entries ONLY: expenses, off-platform/cash
 * income, and adjustments. Platform income (shop orders, treatment bookings)
 * is NEVER duplicated here; it is pulled LIVE at report time from the order
 * and booking data (see @/lib/finance-report). That deliberately avoids the
 * reconciliation bugs a double-entry mirror would create.
 *
 * Read-error semantics (preserved EXACTLY across the layout change):
 * - A fresh store (no entry blobs, no legacy doc) yields []. Blobs are written
 *   lazily on the first `addLedgerEntry`, so a fresh deployment needs no setup.
 * - Any TRANSIENT read failure (the list call, an entry read, or the legacy
 *   read) THROWS so a transient error is never mistaken for "empty ledger" by
 *   a writer — a subsequent save must never clobber real entries.
 * - A listed entry blob that reads as ABSENT (null — e.g. raced delete between
 *   list and read) is skipped, not fatal.
 * - A malformed/corrupt entry (bad JSON or failed shape check) THROWS — same
 *   loud-corruption policy as the orders/treatments stores.
 *
 * TESTABILITY: all Blob I/O goes through an injectable `LedgerStore`
 * (defaults to @vercel/blob). `__setLedgerStore` swaps in an in-memory mock
 * for unit tests — the local BLOB token currently 403s on private content
 * reads, so the persistence layer must be verifiable without real prod Blob.
 */

// --- Domain model -------------------------------------------------------------

/** Per-entry blob prefix (the orders model). */
export const ENTRIES_PREFIX = "finance/entries/";

/** Legacy single-document path (pre-cutover) — still merged by listLedger. */
export const LEGACY_LEDGER_PATHNAME = "finance/ledger.json";

/** Blob path for one entry. */
function entryPathname(id: string): string {
  return `${ENTRIES_PREFIX}${id}.json`;
}

export const EXPENSE_CATEGORIES = [
  "rent",
  "supplies",
  "product-stock",
  "marketing",
  "salaries",
  "utilities",
  "bank-fees",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const INCOME_CATEGORIES = ["treatment-cash", "gift-card", "other"] as const;
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

export const PAYMENT_METHODS = [
  "cash",
  "bank-transfer",
  "card",
  "other",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type LedgerDirection = "expense" | "income";

export interface LedgerEntry {
  id: string;
  /** Calendar date the money moved, YYYY-MM-DD (Cairo). */
  date: string;
  direction: LedgerDirection;
  /** One of EXPENSE_CATEGORIES (expense) or INCOME_CATEGORIES (income). */
  category: string;
  amountEgp: number;
  method: PaymentMethod;
  note: string;
  /** Optional vv-media receipt photo URL; null when none. */
  receiptUrl: string | null;
  createdAt: string;
  /** Always "manual" — the ledger never stores platform-derived income. */
  source: "manual";
}

/** Valid category set for a direction (used by validation + the executors). */
export function categoriesFor(direction: LedgerDirection): readonly string[] {
  return direction === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
}

// --- Injectable storage -------------------------------------------------------

/**
 * The narrow Blob surface the ledger needs.
 * - `read` returns the blob text, or null ONLY for a true 404 (absent blob);
 *   ANY other failure throws (so a transient error is never read as "empty").
 * - `list` returns the pathnames under a prefix; a transient failure throws.
 * - `write` / `remove` mutate a single blob.
 */
export interface LedgerStore {
  read(pathname: string): Promise<string | null>;
  write(pathname: string, body: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  remove(pathname: string): Promise<void>;
}

const blobStore: LedgerStore = {
  async read(pathname) {
    const result = await get(pathname, { access: "private", useCache: false });
    // The SDK returns null for a missing blob (fresh store) and THROWS on
    // transport/auth errors — those propagate to the caller (never clobber).
    if (!result) return null;
    return new Response(result.stream).text();
  },
  async write(pathname, body) {
    await put(pathname, body, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  },
  async list(prefix) {
    // Transient/auth failures propagate (throw) — never read as "empty".
    const { blobs } = await list({ prefix });
    return blobs.map((b) => b.pathname);
  },
  async remove(pathname) {
    await del(pathname);
  },
};

let store: LedgerStore = blobStore;

/** TEST-ONLY: swap the Blob store for an in-memory mock. */
export function __setLedgerStore(next: LedgerStore): void {
  store = next;
}

/** TEST-ONLY: restore the real @vercel/blob store. */
export function __resetLedgerStore(): void {
  store = blobStore;
}

// --- Validation ---------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date in YYYY-MM-DD form. */
export function isValidDateKey(key: string): boolean {
  if (!DATE_RE.test(key)) return false;
  const d = new Date(`${key}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === key;
}

/** Structural check for one stored ledger entry (corruption guard). */
function isValidEntry(value: unknown): value is LedgerEntry {
  const e = value as LedgerEntry | null;
  return (
    typeof e === "object" &&
    e !== null &&
    typeof e.id === "string" &&
    e.id.length > 0 &&
    typeof e.date === "string" &&
    DATE_RE.test(e.date) &&
    (e.direction === "expense" || e.direction === "income") &&
    typeof e.category === "string" &&
    typeof e.amountEgp === "number" &&
    Number.isFinite(e.amountEgp) &&
    typeof e.method === "string" &&
    typeof e.note === "string" &&
    (e.receiptUrl === null || typeof e.receiptUrl === "string") &&
    typeof e.createdAt === "string" &&
    e.source === "manual"
  );
}

// --- Persistence --------------------------------------------------------------

/** Sort key: by calendar date, then by createdAt (stable, deterministic). */
function byDateThenCreated(a: LedgerEntry, b: LedgerEntry): number {
  return a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);
}

/**
 * Read ONE legacy `finance/ledger.json` array if present. Returns [] when the
 * legacy document is absent (the normal post-cutover state). Throws on a
 * transient read failure or on corruption (loud, like the orders store).
 */
async function readLegacyLedger(): Promise<LedgerEntry[]> {
  const text = await store.read(LEGACY_LEDGER_PATHNAME);
  if (text === null) return [];
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data)) {
    throw new Error("Legacy ledger blob is corrupt (not an array)");
  }
  for (const entry of data) {
    if (!isValidEntry(entry)) {
      throw new Error(
        `Legacy ledger blob is corrupt (malformed entry: ${JSON.stringify(entry).slice(0, 200)})`
      );
    }
  }
  return data as LedgerEntry[];
}

/** Read+validate ONE entry blob; null when the listed blob raced a delete. */
async function readEntryBlob(id: string): Promise<LedgerEntry | null> {
  const text = await store.read(entryPathname(id));
  if (text === null) return null;
  const data = JSON.parse(text) as unknown;
  if (!isValidEntry(data)) {
    throw new Error(
      `Ledger entry blob is corrupt (${entryPathname(id)}: ${JSON.stringify(data).slice(0, 200)})`
    );
  }
  return data;
}

/**
 * Read the full ledger. Merges the per-entry blobs under `finance/entries/`
 * with a legacy `finance/ledger.json` array (the per-entry layout wins on id
 * conflict), returning the union sorted by date then createdAt.
 *
 * A fresh store (no entry blobs, no legacy doc) yields []. Any TRANSIENT
 * failure (the list call, an entry read, or the legacy read) throws so a
 * transient error is never mistaken for "empty" by a writer. A listed entry
 * that reads as ABSENT (raced delete) is skipped, not fatal. A malformed entry
 * THROWS — corruption surfaces loudly rather than flowing through garbled.
 */
export async function listLedger(): Promise<LedgerEntry[]> {
  // 1. Per-entry blobs (the orders model). The list call throws on transient
  //    failure; one corrupt blob still throws (loud-corruption policy).
  const pathnames = await store.list(ENTRIES_PREFIX);
  const ids = pathnames.map((p) =>
    p.slice(ENTRIES_PREFIX.length).replace(/\.json$/, "")
  );
  const read = await Promise.all(ids.map((id) => readEntryBlob(id)));

  const byId = new Map<string, LedgerEntry>();
  for (const entry of read) {
    if (entry) byId.set(entry.id, entry);
  }

  // 2. Merge any legacy single-document entries the cutover left behind. The
  //    per-entry layout is authoritative, so legacy rows fill gaps only.
  for (const entry of await readLegacyLedger()) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }

  return [...byId.values()].sort(byDateThenCreated);
}

export interface NewLedgerEntry {
  date: string;
  direction: LedgerDirection;
  category: string;
  amountEgp: number;
  method: PaymentMethod;
  note?: string;
  receiptUrl?: string | null;
}

/**
 * Append a manual entry by writing its OWN blob (`finance/entries/<id>.json`).
 * Returns the stored entry with its generated id/createdAt. Because each add
 * writes a distinct blob, two near-simultaneous adds can NEVER drop an entry
 * (the lost-update bug the old single-document read-modify-write had).
 */
export async function addLedgerEntry(
  input: NewLedgerEntry
): Promise<LedgerEntry> {
  const now = new Date().toISOString();
  const entry: LedgerEntry = {
    id: crypto.randomUUID(),
    date: input.date,
    direction: input.direction,
    category: input.category,
    amountEgp: input.amountEgp,
    method: input.method,
    note: input.note ?? "",
    receiptUrl: input.receiptUrl ?? null,
    createdAt: now,
    source: "manual",
  };
  await store.write(entryPathname(entry.id), JSON.stringify(entry, null, 2));
  return entry;
}

export type LedgerPatch = Partial<
  Pick<
    LedgerEntry,
    "date" | "direction" | "category" | "amountEgp" | "method" | "note" | "receiptUrl"
  >
>;

/**
 * Patch an entry by id. Operates on the single entry blob; an update touches
 * ONLY that entry's blob, so it can never disturb a concurrent add/update of
 * a different entry. Falls back to rewriting the legacy array when (and only
 * when) the id lives there. Returns the updated entry, or null for an unknown
 * id. id/createdAt/source are immutable (the patch type cannot reach them).
 */
export async function updateLedgerEntry(
  id: string,
  patch: LedgerPatch
): Promise<LedgerEntry | null> {
  const existing = await readEntryBlob(id);
  if (existing) {
    const updated: LedgerEntry = { ...existing, ...patch };
    await store.write(entryPathname(id), JSON.stringify(updated, null, 2));
    return updated;
  }

  // Legacy fallback: the row may still live in finance/ledger.json.
  const legacy = await readLegacyLedger();
  const index = legacy.findIndex((e) => e.id === id);
  if (index === -1) return null;
  const updated: LedgerEntry = { ...legacy[index], ...patch };
  legacy[index] = updated;
  await store.write(LEGACY_LEDGER_PATHNAME, JSON.stringify(legacy, null, 2));
  return updated;
}

/**
 * Hard-delete an entry by id. Ledger entries are user-owned records, so a hard
 * delete is correct — there is no public-facing artifact to soft-hide (the
 * deletion is still gated behind a confirm in the admin UI and the assistant).
 * Deletes the single entry blob; falls back to rewriting the legacy array when
 * the id lives there. Returns true when something was removed.
 */
export async function removeLedgerEntry(id: string): Promise<boolean> {
  const existing = await readEntryBlob(id);
  if (existing) {
    await store.remove(entryPathname(id));
    return true;
  }

  // Legacy fallback: the row may still live in finance/ledger.json.
  const legacy = await readLegacyLedger();
  const remaining = legacy.filter((e) => e.id !== id);
  if (remaining.length === legacy.length) return false;
  await store.write(LEGACY_LEDGER_PATHNAME, JSON.stringify(remaining, null, 2));
  return true;
}

// --- Pure helpers (no I/O — unit-testable in isolation) -----------------------

export interface PeriodFilter {
  /** Inclusive start date key, YYYY-MM-DD. */
  from: string;
  /** Inclusive end date key, YYYY-MM-DD. */
  to: string;
  direction?: LedgerDirection;
  category?: string;
}

/**
 * Entries whose `date` falls inside [from, to] (inclusive), optionally
 * narrowed by direction and/or category. Date keys are compared as strings —
 * valid because YYYY-MM-DD sorts lexicographically the same as chronologically.
 */
export function filterByPeriod(
  entries: LedgerEntry[],
  filter: PeriodFilter
): LedgerEntry[] {
  return entries.filter((e) => {
    if (e.date < filter.from || e.date > filter.to) return false;
    if (filter.direction && e.direction !== filter.direction) return false;
    if (filter.category && e.category !== filter.category) return false;
    return true;
  });
}

/** Sum amountEgp grouped by category, returned as a stable, sorted array. */
export function sumByCategory(
  entries: LedgerEntry[]
): { category: string; amountEgp: number }[] {
  const totals = new Map<string, number>();
  for (const e of entries) {
    totals.set(e.category, (totals.get(e.category) ?? 0) + e.amountEgp);
  }
  return [...totals.entries()]
    .map(([category, amountEgp]) => ({ category, amountEgp }))
    .sort(
      (a, b) => b.amountEgp - a.amountEgp || a.category.localeCompare(b.category)
    );
}

/** Total amountEgp across a set of entries. */
export function sumAmount(entries: LedgerEntry[]): number {
  return entries.reduce((sum, e) => sum + e.amountEgp, 0);
}
