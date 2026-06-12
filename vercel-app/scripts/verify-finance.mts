/**
 * Self-contained verification harness for the Wave 2 finance ledger.
 *
 * Run from vercel-app/:   npx tsx scripts/verify-finance.mts
 *
 * WHY SELF-CONTAINED: the local BLOB_READ_WRITE_TOKEN currently 403s on
 * private blob CONTENT reads, so this harness NEVER touches real prod Blob.
 * Instead:
 * - The ledger persistence layer is exercised against an IN-MEMORY LedgerStore
 *   mock (finance.__setLedgerStore) — CRUD round-trips + read-error semantics.
 * - The P&L engine is tested with INJECTED data sources (seeded orders /
 *   bookings / treatments) so the maths is deterministic and offline.
 * - Cal / Blob tokens are BLANKED so any live read fails fast (caught by the
 *   fail-soft P&L gatherer); Telegram + Resend are captured via a fetch mock.
 *
 * No real prod Blob writes ever happen.
 */

import { writeFileSync } from "node:fs";

// --- env: blank every live backend BEFORE app imports ------------------------
process.env.BLOB_READ_WRITE_TOKEN = ""; // ledger uses the in-memory mock instead
process.env.CALCOM_API_KEY = ""; // Cal reads throw fast → caught as failures
process.env.CALCOM_API_URL = "";
process.env.RESEND_API_KEY = "test-resend"; // non-empty → sendReportEmail fetches (captured)
process.env.TELEGRAM_BOT_TOKEN = "TEST:fake-token";
process.env.NOTIFY_EMAIL = "owner@example.com";
process.env.CRON_SECRET = "test-cron-secret";

// --- fetch interception (telegram + resend captured; logo URL → 404) ----------
interface Captured {
  url: string;
  method: string;
  body?: unknown;
  form?: Record<string, { filename?: string; size?: number; text?: string }>;
}
const telegramCalls: Captured[] = [];
const resendCalls: Captured[] = [];
let lastPdf: Buffer | null = null;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? "GET").toUpperCase();

  if (url.includes("api.telegram.org")) {
    const cap: Captured = { url, method };
    if (init?.body instanceof FormData) {
      cap.form = {};
      for (const [key, value] of init.body.entries()) {
        if (value instanceof Blob) {
          const buf = Buffer.from(await value.arrayBuffer());
          const filename = (value as File).name;
          cap.form[key] = { filename, size: buf.length };
          if (filename?.endsWith(".pdf")) lastPdf = buf;
        } else {
          cap.form[key] = { text: String(value) };
        }
      }
    } else if (typeof init?.body === "string") {
      cap.body = JSON.parse(init.body);
    }
    telegramCalls.push(cap);
    return new Response(
      JSON.stringify({ ok: true, result: { message_id: 1 } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  if (url.includes("api.resend.com")) {
    resendCalls.push({
      url,
      method,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify({ id: "mock" }), { status: 200 });
  }

  // The letterhead renderer fetches the live logo — answer 404 fast so it
  // falls back to the bundled public/logo-white.png (no slow network wait).
  if (url.includes("victoriaholisticbeauty.com")) {
    return new Response("not found", { status: 404 });
  }

  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

// --- app imports (after env + fetch patch) -----------------------------------
const finance = await import("../src/lib/finance");
const {
  __setLedgerStore,
  addLedgerEntry,
  listLedger,
  listAllBlobPathnames,
  updateLedgerEntry,
  removeLedgerEntry,
  filterByPeriod,
  sumByCategory,
  sumAmount,
  isValidDateKey,
} = finance;
const {
  computePnL,
  buildPnL,
  pnlToCsv,
  pnlToLetterheadBody,
  resolvePeriod,
  resolvePeriodFromParams,
  previousMonthPeriod,
} = await import("../src/lib/finance-report");
const { orderRevenueEgp } = await import("../src/lib/reports/weekly-report");
const { renderLetterheadPdf } = await import("../src/lib/assistant/letterhead-pdf");
const {
  TOOLS,
  requiresConfirmation,
  validateMutationArgs,
  describeMutation,
  executeTool,
} = await import("../src/lib/assistant/tools");
const { GET: monthlyPnlGET } = await import("../src/app/api/cron/monthly-pnl/route");
const { NextRequest } = await import("next/server");

import type { StoredOrder } from "../src/lib/orders";
import type { CalBooking } from "../src/lib/admin/cal";
import type { Treatment } from "../src/lib/treatments";
import type { LedgerStore, LedgerEntry, BlobListPage } from "../src/lib/finance";
import type { PnLInputs } from "../src/lib/finance-report";

// --- in-memory ledger store (the orders model: one blob per entry) -----------
function makeMemoryStore(): LedgerStore & { dump(): Map<string, string> } {
  const map = new Map<string, string>();
  return {
    async read(pathname: string) {
      return map.has(pathname) ? map.get(pathname)! : null;
    },
    async write(pathname: string, body: string) {
      map.set(pathname, body);
    },
    async list(prefix: string) {
      return [...map.keys()].filter((k) => k.startsWith(prefix));
    },
    async remove(pathname: string) {
      map.delete(pathname);
    },
    dump: () => map,
  };
}

// --- check harness -----------------------------------------------------------
let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

// ============================================================================
console.log("\n=== 1. Ledger CRUD round-trips (in-memory mock) ===");
{
  __setLedgerStore(makeMemoryStore());

  check("fresh store → listLedger returns []", (await listLedger()).length === 0);

  const e1 = await addLedgerEntry({
    date: "2026-06-05",
    direction: "expense",
    category: "supplies",
    amountEgp: 150,
    method: "cash",
    note: "gloves",
  });
  check("addLedgerEntry returns id + createdAt + source", Boolean(e1.id) && e1.source === "manual" && Boolean(e1.createdAt));

  const e2 = await addLedgerEntry({
    date: "2026-06-06",
    direction: "income",
    category: "treatment-cash",
    amountEgp: 800,
    method: "cash",
  });
  check("second add persisted", (await listLedger()).length === 2);

  const updated = await updateLedgerEntry(e1.id, { amountEgp: 175, note: "nitrile gloves" });
  check("updateLedgerEntry patched amount + note", updated?.amountEgp === 175 && updated?.note === "nitrile gloves");
  check("update kept id/createdAt immutable", updated?.id === e1.id && updated?.createdAt === e1.createdAt);

  const missing = await updateLedgerEntry("00000000-0000-4000-8000-000000000000", { amountEgp: 1 });
  check("update unknown id → null", missing === null);

  const removed = await removeLedgerEntry(e2.id);
  check("removeLedgerEntry hard-deletes", removed === true && (await listLedger()).length === 1);
  check("remove unknown id → false", (await removeLedgerEntry("nope-nope")) === false);
}

// ============================================================================
console.log("\n=== 1b. CONCURRENT adds never lose an entry (per-blob, not single-doc RMW) ===");
{
  // The OLD single-document read-modify-write would drop one of these: both
  // adds read the same array, append, and the slower writer overwrites the
  // faster one (last-write-wins on MONEY). The per-blob (orders) model writes
  // a distinct blob per add, so both survive.
  __setLedgerStore(makeMemoryStore());
  const [a, b, c] = await Promise.all([
    addLedgerEntry({ date: "2026-06-10", direction: "expense", category: "supplies", amountEgp: 11, method: "cash" }),
    addLedgerEntry({ date: "2026-06-10", direction: "expense", category: "marketing", amountEgp: 22, method: "cash" }),
    addLedgerEntry({ date: "2026-06-10", direction: "income", category: "treatment-cash", amountEgp: 33, method: "cash" }),
  ]);
  const all = await listLedger();
  const ids = new Set(all.map((e) => e.id));
  check(
    "three concurrent adds → all three persisted (no lost update)",
    all.length === 3 && ids.has(a.id) && ids.has(b.id) && ids.has(c.id),
    `count=${all.length}`
  );
  check("each concurrent add wrote its OWN blob", ids.size === 3);
}

// ============================================================================
console.log("\n=== 1c. Blob list PAGINATION: >1000 entries across pages are all aggregated (no silent truncation) ===");
{
  // @vercel/blob's list() caps at 1000 blobs/page. Before the cursor walk, the
  // store read only page 1 → the P&L silently UNDERCOUNTED past 1000 entries.
  // Drive the REAL cursor loop (listAllBlobPathnames) with a mock lister that
  // serves TWO pages via hasMore/cursor and assert the FULL union comes back.
  const ENTRIES = "finance/entries/";
  const TOTAL = 1500; // straddles the 1000 cap → forces a second page
  const all = Array.from({ length: TOTAL }, (_, i) => `${ENTRIES}e${i}.json`);

  let listCalls = 0;
  const pagedLister = async (opts: { prefix: string; cursor?: string; limit: number }): Promise<BlobListPage> => {
    listCalls++;
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const slice = all.filter((p) => p.startsWith(opts.prefix)).slice(start, start + opts.limit);
    const next = start + opts.limit;
    const more = next < TOTAL;
    return {
      blobs: slice.map((pathname) => ({ pathname })),
      cursor: more ? String(next) : undefined,
      hasMore: more,
    };
  };

  const aggregated = await listAllBlobPathnames(ENTRIES, pagedLister);
  check(
    "cursor walk aggregates ALL 1500 pathnames (not truncated at 1000)",
    aggregated.length === TOTAL,
    `got ${aggregated.length}`
  );
  check("cursor walk made >1 list() call (followed hasMore)", listCalls >= 2, `calls=${listCalls}`);
  check("no duplicates / no gaps in the aggregated set", new Set(aggregated).size === TOTAL);

  // A single full page (hasMore=false on the first call) must stop after ONE call.
  let oneShot = 0;
  const singlePage = async (opts: { prefix: string; cursor?: string; limit: number }): Promise<BlobListPage> => {
    oneShot++;
    return { blobs: [{ pathname: `${opts.prefix}only.json` }], hasMore: false };
  };
  const single = await listAllBlobPathnames(ENTRIES, singlePage);
  check("single-page result stops after one call (no needless paging)", single.length === 1 && oneShot === 1);
}

// ============================================================================
console.log("\n=== 2. Read-error semantics (per-blob layout: throws on transient, [] on fresh, throws on corrupt) ===");
{
  const ENTRIES = "finance/entries/";
  const LEGACY = "finance/ledger.json";
  const goodEntry = (id: string) =>
    JSON.stringify(mkEntry("2026-06-05", "expense", "supplies", 150) as LedgerEntry).replace(
      /"id":"[^"]*"/,
      `"id":"${id}"`
    );

  async function expectThrow(name: string, fn: () => Promise<unknown>) {
    let threw = false;
    try {
      await fn();
    } catch {
      threw = true;
    }
    check(name, threw);
  }

  // fresh store (no entry blobs, no legacy doc) → []
  __setLedgerStore({
    async read() {
      return null;
    },
    async write() {},
    async list() {
      return [];
    },
    async remove() {},
  });
  check("fresh store (list=[], legacy absent) → []", (await listLedger()).length === 0);

  // transient failure on the LIST call → THROWS (never read as empty)
  __setLedgerStore({
    async read() {
      return null;
    },
    async write() {},
    async list() {
      throw new Error("simulated transient list 500");
    },
    async remove() {},
  });
  await expectThrow("transient list() error → listLedger THROWS", () => listLedger());

  // transient failure on an ENTRY read → THROWS
  __setLedgerStore({
    async read() {
      throw new Error("simulated transient entry read 500");
    },
    async write() {},
    async list() {
      return [`${ENTRIES}abc.json`];
    },
    async remove() {},
  });
  await expectThrow("transient entry read error → listLedger THROWS", () => listLedger());

  // transient failure on the LEGACY read → THROWS
  __setLedgerStore({
    async read(p: string) {
      if (p === LEGACY) throw new Error("simulated transient legacy read 500");
      return null;
    },
    async write() {},
    async list() {
      return [];
    },
    async remove() {},
  });
  await expectThrow("transient legacy read error → listLedger THROWS", () => listLedger());

  // legacy corrupt (not an array) → THROWS
  __setLedgerStore({
    async read(p: string) {
      return p === LEGACY ? JSON.stringify({ not: "an array" }) : null;
    },
    async write() {},
    async list() {
      return [];
    },
    async remove() {},
  });
  await expectThrow("corrupt legacy blob (not array) → listLedger THROWS", () => listLedger());

  // malformed ENTRY blob → THROWS
  __setLedgerStore({
    async read(p: string) {
      return p.startsWith(ENTRIES) ? JSON.stringify({ id: "x", date: "nope" }) : null;
    },
    async write() {},
    async list() {
      return [`${ENTRIES}x.json`];
    },
    async remove() {},
  });
  await expectThrow("malformed entry blob → listLedger THROWS", () => listLedger());

  // a listed entry that reads ABSENT (raced delete) is SKIPPED, not fatal
  __setLedgerStore({
    async read(p: string) {
      if (p === `${ENTRIES}present.json`) return goodEntry("present");
      return null; // "absent.json" races a delete → null
    },
    async write() {},
    async list() {
      return [`${ENTRIES}present.json`, `${ENTRIES}absent.json`];
    },
    async remove() {},
  });
  const racedList = await listLedger();
  check("listed-but-absent entry is skipped (not fatal)", racedList.length === 1 && racedList[0].id === "present");

  // DUAL-LAYOUT MERGE: per-entry blobs ∪ legacy array; per-entry wins on id.
  const mergeMap = new Map<string, string>();
  mergeMap.set(`${ENTRIES}E1.json`, goodEntry("E1")); // amount 150
  mergeMap.set(
    LEGACY,
    JSON.stringify([
      { ...(JSON.parse(goodEntry("E1")) as LedgerEntry), amountEgp: 999 }, // stale dup of E1
      { ...(JSON.parse(goodEntry("L9")) as LedgerEntry) }, // legacy-only entry
    ])
  );
  __setLedgerStore({
    async read(p: string) {
      return mergeMap.has(p) ? mergeMap.get(p)! : null;
    },
    async write() {},
    async list(prefix: string) {
      return [...mergeMap.keys()].filter((k) => k.startsWith(prefix));
    },
    async remove() {},
  });
  const merged = await listLedger();
  const e1 = merged.find((e) => e.id === "E1");
  check("dual-layout merge: union of entries + legacy", merged.length === 2 && merged.some((e) => e.id === "L9"));
  check("dual-layout merge: per-entry blob WINS over legacy dup", e1?.amountEgp === 150);
}

// ============================================================================
console.log("\n=== 2b. Legacy-only id: update rewrites the legacy array, remove filters it out ===");
{
  // A row that lives ONLY in the legacy finance/ledger.json (no per-entry blob)
  // must stay editable: update/remove fall back to rewriting the legacy array.
  const LEGACY = "finance/ledger.json";
  const ENTRIES = "finance/entries/";
  const store = makeMemoryStore();
  __setLedgerStore(store);

  const legacyUpd: LedgerEntry = { ...mkEntry("2026-06-04", "expense", "rent", 5000, "legacy rent"), id: "LEGACY-UPD" };
  const legacyRem: LedgerEntry = { ...mkEntry("2026-06-05", "income", "treatment-cash", 700), id: "LEGACY-REM" };
  store.dump().set(LEGACY, JSON.stringify([legacyUpd, legacyRem]));

  // sanity: both surface via listLedger even though no per-entry blob exists
  const before = await listLedger();
  check("legacy-only rows surface via listLedger", before.length === 2 && before.some((e) => e.id === "LEGACY-UPD") && before.some((e) => e.id === "LEGACY-REM"));

  // UPDATE a legacy-only id → rewrites the legacy array (no per-entry blob made)
  const updated = await updateLedgerEntry("LEGACY-UPD", { amountEgp: 5250, note: "legacy rent (adjusted)" });
  check("update(legacy-only) returns the patched entry", updated?.amountEgp === 5250 && updated?.note === "legacy rent (adjusted)");
  check("update(legacy-only) kept id/createdAt immutable", updated?.id === "LEGACY-UPD" && updated?.createdAt === legacyUpd.createdAt);
  check("update(legacy-only) did NOT create a per-entry blob", !store.dump().has(`${ENTRIES}LEGACY-UPD.json`));
  const rewritten = JSON.parse(store.dump().get(LEGACY)!) as LedgerEntry[];
  check("update(legacy-only) rewrote the legacy array in place", rewritten.find((e) => e.id === "LEGACY-UPD")?.amountEgp === 5250 && rewritten.length === 2);

  // REMOVE a legacy-only id → filters it out of the legacy array
  const removed = await removeLedgerEntry("LEGACY-REM");
  check("remove(legacy-only) returns true", removed === true);
  const afterRemove = JSON.parse(store.dump().get(LEGACY)!) as LedgerEntry[];
  check("remove(legacy-only) filtered the row out of the legacy array", afterRemove.length === 1 && !afterRemove.some((e) => e.id === "LEGACY-REM"));
  const finalList = await listLedger();
  check("remove(legacy-only) reflected in listLedger (1 row left)", finalList.length === 1 && finalList[0].id === "LEGACY-UPD");
  check("remove(legacy-only) unknown id → false", (await removeLedgerEntry("LEGACY-NOPE")) === false);
}

// ============================================================================
console.log("\n=== 3. Pure helpers: filterByPeriod / sumByCategory / sumAmount ===");
{
  const entries: LedgerEntry[] = [
    mkEntry("2026-06-05", "expense", "supplies", 150),
    mkEntry("2026-06-20", "expense", "rent", 5000),
    mkEntry("2026-05-31", "expense", "marketing", 100), // out of June
    mkEntry("2026-06-10", "income", "treatment-cash", 200),
  ];
  const june = filterByPeriod(entries, { from: "2026-06-01", to: "2026-06-30" });
  check("filterByPeriod excludes out-of-range", june.length === 3);
  const juneExpenses = filterByPeriod(entries, { from: "2026-06-01", to: "2026-06-30", direction: "expense" });
  check("filterByPeriod direction filter", juneExpenses.length === 2);
  const byCat = sumByCategory(juneExpenses);
  check("sumByCategory sorts by amount desc", byCat[0].category === "rent" && byCat[0].amountEgp === 5000);
  check("sumAmount totals", sumAmount(juneExpenses) === 5150);
  check("isValidDateKey rejects fake dates", isValidDateKey("2026-06-31") === false && isValidDateKey("2026-06-30") === true);
}

// ============================================================================
console.log("\n=== 4. computePnL maths + shop-revenue cross-check with weekly report ===");
const period = { from: "2026-06-01", to: "2026-06-30", label: "June 2026", tag: "2026-06" };
let pnlSample: ReturnType<typeof computePnL>;
{
  const orders: StoredOrder[] = [
    mkOrder("VV-AAAAAA", "confirmed", 1000, "2026-06-10T12:00:00.000Z"),
    mkOrder("VV-BBBBBB", "delivered", 500, "2026-06-12T12:00:00.000Z"),
    mkOrder("VV-CCCCCC", "cancelled", 999, "2026-06-13T12:00:00.000Z"), // excluded
    mkOrder("VV-DDDDDD", "ordered", 300, "2026-06-14T12:00:00.000Z"), // not revenue
    mkOrder("VV-EEEEEE", "confirmed", 700, "2026-05-20T12:00:00.000Z"), // out of range
  ];
  const treatments: Treatment[] = [
    mkTreatment("facial-massage", "Facial Massage", 3350, 327658),
    mkTreatment("hydrofacial", "HydroFacial + Ultrasonic Cleaning", 3700, 327662),
  ];
  const bookings: CalBooking[] = [
    mkBooking("Facial Massage between Victoria and A", "accepted", "2026-06-08T09:00:00.000Z", 327658),
    mkBooking("Facial Massage between Victoria and B", "accepted", "2026-06-15T09:00:00.000Z", 327658),
    mkBooking("HydroFacial + Ultrasonic Cleaning between Victoria and C", "accepted", "2026-06-18T09:00:00.000Z", 327662),
    mkBooking("Facial Massage between Victoria and D", "pending", "2026-06-19T09:00:00.000Z", 327658), // not confirmed
    mkBooking("Mystery Service between Victoria and E", "accepted", "2026-06-20T09:00:00.000Z", 999999), // eventTypeId not in catalogue → unmatched
    mkBooking("Facial Massage between Victoria and F", "accepted", "2026-07-02T09:00:00.000Z", 327658), // out of range
  ];
  const ledger: LedgerEntry[] = [
    mkEntry("2026-06-03", "income", "treatment-cash", 200),
    mkEntry("2026-06-04", "income", "gift-card", 300),
    mkEntry("2026-06-05", "expense", "supplies", 150),
    mkEntry("2026-06-20", "expense", "rent", 5000, 'Office rent, "June"'),
    mkEntry("2026-05-15", "expense", "marketing", 100), // out of range
  ];
  const inputs: PnLInputs = { orders, bookings, treatments, ledger };
  pnlSample = computePnL(period, inputs);

  check("shop revenue = 1500 (confirmed+delivered, in range)", pnlSample.revenue.shopEgp === 1500, String(pnlSample.revenue.shopEgp));
  // Cross-check: same shop number from the weekly-report helper for the same orders.
  const inRange = orders.filter((o) => o.createdAt.slice(0, 7) === "2026-06");
  check("shop revenue == orderRevenueEgp(in-range orders) (reuse, not reinvent)", pnlSample.revenue.shopEgp === orderRevenueEgp(inRange));
  check("treatments revenue = 10400 (3350+3350+3700)", pnlSample.revenue.treatmentsEgp === 10400, String(pnlSample.revenue.treatmentsEgp));
  check("unmatched booking counted (1)", pnlSample.revenue.unmatchedBookings === 1);
  check("manual income = 500", pnlSample.revenue.manualIncomeEgp === 500);
  check("total revenue = 12400", pnlSample.revenue.totalEgp === 12400, String(pnlSample.revenue.totalEgp));
  check("expenses total = 5150", pnlSample.expenses.totalEgp === 5150, String(pnlSample.expenses.totalEgp));
  check("expense breakdown: rent 5000 first, supplies 150", pnlSample.expenses.byCategory[0].category === "rent" && pnlSample.expenses.byCategory[0].amountEgp === 5000);
  check("NET = 7250 (12400 − 5150)", pnlSample.netEgp === 7250, String(pnlSample.netEgp));
  check("counts: 2 revenue orders, 4 confirmed bookings, 4 in-range entries", pnlSample.counts.revenueOrders === 2 && pnlSample.counts.confirmedBookings === 4 && pnlSample.counts.ledgerEntries === 4);

  // onlyPastBookings flag: nothing is "past" relative to a fixed past `now`.
  const futureNow = computePnL(period, { ...inputs, now: new Date("2026-06-01T00:00:00Z"), onlyPastBookings: true });
  check("onlyPastBookings drops future-dated confirmed bookings", futureNow.revenue.treatmentsEgp === 0);
}

// ============================================================================
console.log("\n=== 4b. Treatment match by eventTypeId (robust to renames / RU titles) ===");
{
  const treatments: Treatment[] = [
    mkTreatment("facial-massage", "Facial Massage", 3350, 327658, "Массаж лица"),
  ];

  // eventTypeId is AUTHORITATIVE: a Russian-titled booking that could never
  // match the English catalogue name still prices correctly via eventTypeId.
  const ruTitled = computePnL(period, {
    orders: [],
    ledger: [],
    treatments,
    bookings: [
      mkBooking("Массаж лица между Викторией и G", "accepted", "2026-06-09T09:00:00.000Z", 327658),
    ],
  });
  check("eventTypeId prices a RU-titled booking the name match would miss", ruTitled.revenue.treatmentsEgp === 3350 && ruTitled.revenue.unmatchedBookings === 0);

  // A present-but-uncatalogued eventTypeId is UNMATCHED even when the title
  // would have matched (eventTypeId wins → no coincidental title rescue).
  const wrongId = computePnL(period, {
    orders: [],
    ledger: [],
    treatments,
    bookings: [
      mkBooking("Facial Massage between Victoria and H", "accepted", "2026-06-09T09:00:00.000Z", 111111),
    ],
  });
  check("present-but-uncatalogued eventTypeId → unmatched (no title rescue)", wrongId.revenue.treatmentsEgp === 0 && wrongId.revenue.unmatchedBookings === 1);

  // No eventTypeId on the booking → fall back to the service-title match.
  const noId = computePnL(period, {
    orders: [],
    ledger: [],
    treatments: [mkTreatment("facial-massage", "Facial Massage", 3350, 327658)],
    bookings: [
      {
        ...mkBooking("Facial Massage between Victoria and J", "accepted", "2026-06-09T09:00:00.000Z"),
        eventTypeId: undefined as unknown as number,
      },
    ],
  });
  check("no eventTypeId → falls back to title match", noId.revenue.treatmentsEgp === 3350 && noId.revenue.unmatchedBookings === 0);
}

// ============================================================================
console.log("\n=== 5. buildPnL with INJECTED sources matches computePnL ===");
{
  const memStore = makeMemoryStore();
  __setLedgerStore(memStore);
  await addLedgerEntry({ date: "2026-06-03", direction: "income", category: "treatment-cash", amountEgp: 200, method: "cash" });
  await addLedgerEntry({ date: "2026-06-05", direction: "expense", category: "supplies", amountEgp: 150, method: "cash" });

  const built = await buildPnL(period, {
    sources: {
      listOrders: async () => [mkOrder("VV-AAAAAA", "confirmed", 1000, "2026-06-10T12:00:00.000Z")],
      listBookingsInRange: async () => [],
      getTreatmentsCatalog: async () => [],
      listLedger, // real, backed by the in-memory mock
    },
  });
  check("buildPnL gathered ledger from mock store", built.revenue.manualIncomeEgp === 200 && built.expenses.totalEgp === 150);
  check("buildPnL shop revenue from injected orders", built.revenue.shopEgp === 1000);
  check("buildPnL net = 1050 (1000+200−150)", built.netEgp === 1050, String(built.netEgp));
  check("buildPnL no failures with healthy sources", built.failures.length === 0);
}

// ============================================================================
console.log("\n=== 6. CSV export is well-formed and round-trips (incl. escaping) ===");
{
  const csv = pnlToCsv(pnlSample);
  const rows = parseCsv(csv);
  // Locate the entries header then assert the escaped note round-trips.
  const headerIdx = rows.findIndex((r) => r[0] === "date" && r[1] === "direction");
  check("CSV has an entries header row", headerIdx >= 0);
  const dataRows = rows.slice(headerIdx + 1).filter((r) => r.length >= 7 && /^\d{4}-\d{2}-\d{2}$/.test(r[0]));
  check("CSV lists all 4 in-range entries", dataRows.length === 4, String(dataRows.length));
  const rentRow = dataRows.find((r) => r[2] === "rent");
  check('CSV escaped a note with comma + quotes ("Office rent, \\"June\\"")', rentRow?.[5] === 'Office rent, "June"', JSON.stringify(rentRow?.[5]));
  const net = rows.find((r) => r[0] === "NET (revenue − expenses)");
  check("CSV summary carries NET = 7250", net?.[1] === "7250", JSON.stringify(net));
  writeFileSync("/tmp/finance-pnl-sample.csv", csv);
  console.log("CSV saved: /tmp/finance-pnl-sample.csv");

  // --- formula-injection guard (STRING cells) + numeric cells untouched ---
  const evilPeriod = { from: "2026-06-01", to: "2026-06-30", label: "June 2026", tag: "2026-06" };
  const evilPnl = computePnL(evilPeriod, {
    orders: [],
    bookings: [],
    treatments: [],
    ledger: [
      mkEntry("2026-06-02", "expense", "marketing", 50, "=cmd|'/c calc'!A1"), // formula payload
      mkEntry("2026-06-03", "expense", "supplies", 50, "@SUM(1+1)"), // @ lead
      mkEntry("2026-06-04", "expense", "rent", 9000), // makes net NEGATIVE
    ],
  });
  const evilRows = parseCsv(pnlToCsv(evilPnl));
  const evilHeaderIdx = evilRows.findIndex((r) => r[0] === "date" && r[1] === "direction");
  const evilData = evilRows.slice(evilHeaderIdx + 1).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[0]));
  const eqNote = evilData.find((r) => r[2] === "marketing")?.[5];
  const atNote = evilData.find((r) => r[2] === "supplies")?.[5];
  check("CSV neutralises a leading '=' note (apostrophe prefix)", eqNote === "'=cmd|'/c calc'!A1", JSON.stringify(eqNote));
  check("CSV neutralises a leading '@' note (apostrophe prefix)", atNote === "'@SUM(1+1)", JSON.stringify(atNote));
  // NUMERIC cells must stay numeric — a negative NET keeps its leading '-'.
  const evilNet = evilRows.find((r) => r[0] === "NET (revenue − expenses)");
  check("CSV keeps a NEGATIVE net numeric (no apostrophe)", evilNet?.[1] === "-9100", JSON.stringify(evilNet));
  const evilAmount = evilData.find((r) => r[2] === "marketing")?.[3];
  check("CSV numeric amount cell is untouched", evilAmount === "50", JSON.stringify(evilAmount));
}

// ============================================================================
console.log("\n=== 7. P&L PDF on letterhead — EN + RU (Cyrillic) ===");
{
  const enBody = pnlToLetterheadBody(pnlSample);
  const en = await renderLetterheadPdf({ title: `Profit & Loss — ${pnlSample.period.label}`, body: enBody });
  check("EN P&L PDF looks like a PDF", en.pdf.subarray(0, 5).toString().startsWith("%PDF"), `size=${en.pdf.length}`);
  check("EN PDF embeds the PT fonts (no built-in Helvetica)", (en.pdf.includes("PTSerif-Regular") || en.pdf.includes("PTSans-Regular")) && !en.pdf.includes("/BaseFont /Helvetica"));
  check("EN PDF is a single page (one /Type /Page)", countPdfPages(en.pdf) === 1, `pages=${countPdfPages(en.pdf)}`);
  writeFileSync("/tmp/finance-pnl-en.pdf", en.pdf);
  console.log("EN PDF saved: /tmp/finance-pnl-en.pdf");

  const ruBody = [
    "# Выручка",
    "- Магазин: 1500 EGP",
    "- Процедуры: 10400 EGP",
    "# Расходы",
    "- аренда: 5000 EGP",
    "# Итог",
    "- Чистая прибыль: 7250 EGP",
  ].join("\n");
  const ru = await renderLetterheadPdf({ title: "Отчёт о прибылях и убытках — Июнь 2026", body: ruBody });
  check("RU P&L PDF generated", ru.pdf.subarray(0, 5).toString().startsWith("%PDF"), `size=${ru.pdf.length}`);
  check("RU PDF did NOT strip Cyrillic (embedded fonts cover it)", ru.unsupportedCharsStripped === false);
  writeFileSync("/tmp/finance-pnl-ru.pdf", ru.pdf);
  console.log("RU PDF saved: /tmp/finance-pnl-ru.pdf");
}

// ============================================================================
console.log("\n=== 8. Vassili finance tools: schema, gate, disclosure, executors ===");
{
  const memStore = makeMemoryStore();
  __setLedgerStore(memStore);
  const ctx = { chatId: 770_077_001 };

  // schema presence
  const names = TOOLS.map((t) => t.function.name);
  check("TOOLS includes the 4 finance tools", ["log_expense", "log_income", "finance_summary", "finance_pnl_document"].every((n) => names.includes(n)));

  // log_expense is MUTATING (needs confirm), finance_summary/document are read-only
  check("log_expense requires confirmation", requiresConfirmation("log_expense", { category: "supplies", amountEgp: 150, method: "cash" }));
  check("log_income requires confirmation", requiresConfirmation("log_income", { category: "treatment-cash", amountEgp: 200, method: "cash" }));
  check("finance_summary is read-only (no confirm)", !requiresConfirmation("finance_summary", { period: "month" }));
  check("finance_pnl_document is read-only (no confirm)", !requiresConfirmation("finance_pnl_document", { period: "month" }));

  // gate validation: numbers-as-strings coerce; bad category refused
  const v1 = validateMutationArgs("log_expense", { category: "supplies", amountEgp: "150", method: "cash" });
  check("validateMutationArgs coerces amountEgp '150' → 150", v1.ok && v1.args.amountEgp === 150);
  const v2 = validateMutationArgs("log_expense", { category: "not-a-category", amountEgp: 10, method: "cash" });
  check("validateMutationArgs refuses an out-of-enum category", !v2.ok);

  // amount>0 GATE: a non-positive / NaN amount is refused before the confirm
  // card is ever built (so the card can never show a value that fails on tap).
  const vZero = validateMutationArgs("log_expense", { category: "supplies", amountEgp: 0, method: "cash" });
  check("gate refuses amountEgp = 0 (log_expense)", !vZero.ok);
  const vNeg = validateMutationArgs("log_income", { category: "treatment-cash", amountEgp: -5, method: "cash" });
  check("gate refuses negative amountEgp (log_income)", !vNeg.ok);
  const vNegStr = validateMutationArgs("log_expense", { category: "supplies", amountEgp: "-5", method: "cash" });
  check("gate refuses negative amountEgp as string", !vNegStr.ok);
  const vNan = validateMutationArgs("log_expense", { category: "supplies", amountEgp: "abc", method: "cash" });
  check("gate refuses non-numeric amountEgp", !vNan.ok);
  const vGood = validateMutationArgs("log_expense", { category: "supplies", amountEgp: 1, method: "cash" });
  check("gate accepts a positive amountEgp", vGood.ok);

  // structural disclosure
  const disc = describeMutation("log_expense", { category: "rent", amountEgp: 5000, method: "bank-transfer", date: "2026-06-01" });
  check("describeMutation log_expense discloses 'private — not visible to clients'", /not visible to clients/i.test(disc) && /5000 EGP/.test(disc), disc.slice(0, 160));

  // executor persists to the mock store (the Confirm-tap path)
  const r1 = await executeTool("log_expense", { category: "supplies", amountEgp: 150, method: "cash", note: "gloves" }, ctx);
  check("executeTool(log_expense) reports logged", /Expense logged/.test(r1) && /150 EGP/.test(r1), r1.slice(0, 120));
  const r2 = await executeTool("log_income", { category: "treatment-cash", amountEgp: 800, method: "cash", date: "2026-06-07" }, ctx);
  check("executeTool(log_income) reports logged", /Income logged/.test(r2) && /800 EGP/.test(r2), r2.slice(0, 120));
  const persisted = await listLedger();
  check("both entries persisted in the mock store", persisted.length === 2 && persisted.some((e) => e.direction === "expense" && e.amountEgp === 150) && persisted.some((e) => e.direction === "income" && e.amountEgp === 800));

  // finance_summary returns numbers (manual portion deterministic; platform
  // sources are offline here so they report as failures and read 0).
  const summary = await executeTool("finance_summary", { period: "month" }, ctx);
  console.log("--- finance_summary ---\n" + summary);
  check("finance_summary returns a P&L with numbers", /P&L for/.test(summary) && /Revenue —/.test(summary) && /Net —/.test(summary));
  check("finance_summary reflects the logged manual entries", /cash\/other income: 800 EGP/.test(summary) && /supplies: 150 EGP/.test(summary));

  // finance_pnl_document → PDF to the OWNER chat only (captured at telegram)
  telegramCalls.length = 0;
  lastPdf = null;
  const docResult = await executeTool("finance_pnl_document", { period: "month" }, ctx);
  console.log("--- finance_pnl_document ---\n" + docResult);
  const docCall = telegramCalls.find((c) => c.url.includes("sendDocument"));
  check("finance_pnl_document sent a document via Telegram", Boolean(docCall));
  check("document went to the OWNER chat only", docCall?.form?.chat_id?.text === String(ctx.chatId));
  // TS can't see the fetch-closure reassignment after the reset — widen.
  const docPdf = lastPdf as Buffer | null;
  check("captured a real PDF", Boolean(docPdf && docPdf.subarray(0, 5).toString().startsWith("%PDF")), `size=${docPdf?.length}`);
  if (docPdf) {
    writeFileSync("/tmp/finance-pnl-vassili.pdf", docPdf);
    console.log("Vassili P&L PDF saved: /tmp/finance-pnl-vassili.pdf");
  }
}

// ============================================================================
console.log("\n=== 9. resolvePeriod / resolvePeriodFromParams / previousMonthPeriod ===");
{
  const now = new Date("2026-06-12T10:00:00.000Z");
  const month = resolvePeriod({ period: "month", now });
  check("resolvePeriod(month) → June bounds", month.ok && month.period.from === "2026-06-01" && month.period.to === "2026-06-30");
  const week = resolvePeriod({ period: "week", now });
  check("resolvePeriod(week) → 7-day Mon–Sun range", week.ok && /this week/.test(week.period.label));
  const custom = resolvePeriod({ period: "custom", from: "2026-06-30", to: "2026-06-01", now });
  check("resolvePeriod(custom) swaps reversed dates", custom.ok && custom.period.from === "2026-06-01" && custom.period.to === "2026-06-30");
  const badCustom = resolvePeriod({ period: "custom", from: "nope", to: "2026-06-01", now });
  check("resolvePeriod(custom) rejects bad dates", !badCustom.ok);
  const fromParams = resolvePeriodFromParams(new URLSearchParams("month=2026-04"), now);
  check("resolvePeriodFromParams(month=2026-04) → April", fromParams.ok && fromParams.period.from === "2026-04-01" && fromParams.period.to === "2026-04-30");
  const prev = previousMonthPeriod(now);
  check("previousMonthPeriod(June) → May", prev.from === "2026-05-01" && prev.to === "2026-05-31" && prev.tag === "2026-05");
}

// ============================================================================
console.log("\n=== 10. monthly-pnl cron route: auth + window guard + forced build ===");
{
  __setLedgerStore(makeMemoryStore());
  await addLedgerEntry({ date: previousMonthPeriod().from, direction: "expense", category: "rent", amountEgp: 4000, method: "bank-transfer" });

  const base = "https://book.victoriaholisticbeauty.com/api/cron/monthly-pnl";

  // (a) 401 without bearer
  const noAuth = await monthlyPnlGET(new NextRequest(base));
  check("401 without bearer", noAuth.status === 401);

  // (b) bearer, no force → today (2026-06-12) is not the 1st 09:00 → skipped
  const offWindow = await monthlyPnlGET(
    new NextRequest(base, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })
  );
  const offJson = (await offWindow.json()) as { skipped?: string };
  check("off-window firing returns {skipped}", typeof offJson.skipped === "string", JSON.stringify(offJson).slice(0, 120));

  // (c) forced run builds LAST month's P&L and ATTEMPTS the sends (captured).
  resendCalls.length = 0;
  const forced = await monthlyPnlGET(
    new NextRequest(`${base}?force=1`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })
  );
  const forcedJson = (await forced.json()) as {
    period?: string;
    expenses?: number;
    email?: { sentCount?: number };
    ok?: boolean;
  };
  console.log("forced monthly-pnl response:", JSON.stringify(forcedJson).slice(0, 220));
  const prevLabel = previousMonthPeriod().label;
  check("forced run targets the previous month", forcedJson.period === prevLabel, `period=${forcedJson.period} expected=${prevLabel}`);
  check("forced run picked up the seeded expense (4000)", forcedJson.expenses === 4000, String(forcedJson.expenses));
  const mailCall = resendCalls.find((c) => /Monthly P&L/.test(String((c.body as { subject?: string })?.subject)));
  check("monthly-pnl ATTEMPTED a Resend email (captured)", Boolean(mailCall));
  check("the email carried a PDF attachment", Array.isArray((mailCall?.body as { attachments?: unknown[] })?.attachments) && (mailCall?.body as { attachments?: unknown[] }).attachments!.length === 1);
}

// ============================================================================
console.log("\n=== 11. Day-marker SELF-CLEAR (claim → already-sent → release → re-claim) ===");
{
  // Drive the REAL claimDailySend / releaseDailySend (which call @vercel/blob's
  // put/del) against a LOOPBACK HTTP server speaking just enough of the Blob
  // API. The SDK fetches via undici, so a real 127.0.0.1 server is required (a
  // globalThis.fetch mock would be bypassed). This proves the finding-7
  // primitive: after a TOTAL send failure releases the marker, the SAME day is
  // re-drivable (workflow_dispatch / next DST firing) instead of a burned
  // marker permanently suppressing the month's P&L.
  const { createServer } = await import("node:http");
  const markers = new Map<string, string>();
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const reply = (status: number, body: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.method === "PUT") {
        const pathname = u.searchParams.get("pathname") ?? "";
        const overwrite = req.headers["x-allow-overwrite"];
        if (markers.has(pathname) && overwrite !== "1") {
          // The code that maps to a message-preserving BlobError so
          // claimDailySend's /blob already exists/i conflict check fires.
          reply(400, { error: { code: "bad_request", message: "This blob already exists" } });
          return;
        }
        markers.set(pathname, Buffer.concat(chunks).toString() || "{}");
        reply(200, {
          url: `http://127.0.0.1/${pathname}`,
          downloadUrl: `http://127.0.0.1/${pathname}`,
          pathname,
          contentType: "application/json",
          contentDisposition: `attachment; filename="${pathname}"`,
          etag: "mock",
        });
        return;
      }
      if (req.method === "POST" && u.pathname === "/delete") {
        const parsed = JSON.parse(Buffer.concat(chunks).toString() || "{}") as { urls?: string[] };
        for (const target of parsed.urls ?? []) {
          const key = target.replace(/^https?:\/\/[^/]+\//, "");
          markers.delete(key);
          markers.delete(target);
        }
        reply(200, {});
        return;
      }
      reply(200, {});
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const prevBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
  const prevBlobUrl = process.env.VERCEL_BLOB_API_URL;
  const prevRetries = process.env.VERCEL_BLOB_RETRIES;
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_TESTSTORE_secret";
  process.env.VERCEL_BLOB_API_URL = `http://127.0.0.1:${port}`;
  process.env.VERCEL_BLOB_RETRIES = "0"; // no backoff — fail fast on any mismatch

  const { claimDailySend, releaseDailySend } = await import("../src/lib/reports/shared");
  const day = "2026-07-01";

  const first = await claimDailySend("monthly-pnl", day);
  check("first claim → 'claimed'", first === "claimed", String(first));

  const second = await claimDailySend("monthly-pnl", day);
  check("second claim (same day) → 'already-sent' (conflict)", second === "already-sent", String(second));

  const released = await releaseDailySend("monthly-pnl", day);
  check("releaseDailySend deletes the marker → true", released === true);

  const reclaim = await claimDailySend("monthly-pnl", day);
  check("after release the SAME day is re-claimable → 'claimed' (self-clear)", reclaim === "claimed", String(reclaim));

  await new Promise<void>((resolve) => server.close(() => resolve()));
  // Restore the blanked tokens so nothing else in the process picks them up.
  process.env.BLOB_READ_WRITE_TOKEN = prevBlobToken ?? "";
  if (prevBlobUrl === undefined) delete process.env.VERCEL_BLOB_API_URL;
  else process.env.VERCEL_BLOB_API_URL = prevBlobUrl;
  if (prevRetries === undefined) delete process.env.VERCEL_BLOB_RETRIES;
  else process.env.VERCEL_BLOB_RETRIES = prevRetries;
}

// ============================================================================
console.log(`\n=== DONE — ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} ===`);
finance.__resetLedgerStore();
process.exit(failures === 0 ? 0 : 1);

// --- factories ---------------------------------------------------------------
function mkEntry(
  date: string,
  direction: "expense" | "income",
  category: string,
  amountEgp: number,
  note = ""
): LedgerEntry {
  return {
    id: crypto.randomUUID(),
    date,
    direction,
    category,
    amountEgp,
    method: "cash",
    note,
    receiptUrl: null,
    createdAt: new Date().toISOString(),
    source: "manual",
  };
}

function mkOrder(orderNumber: string, status: string, egp: number, createdAt: string): StoredOrder {
  return {
    orderNumber,
    createdAt,
    status: status as StoredOrder["status"],
    items: [{ slug: "x", qty: 1, names: { en: "X", ru: "Х" }, lineTotals: { egp, rub: 0 } }],
    totals: { egp, rub: 0 },
    name: "Buyer",
    phone: "+200000000",
    email: "",
    address: "",
    note: "",
    lang: "en",
    statusHistory: [],
  };
}

function mkTreatment(
  slug: string,
  nameEn: string,
  priceEgp: number,
  eventTypeId = 1,
  nameRu = nameEn
): Treatment {
  return {
    slug,
    eventTypeId,
    name: { en: nameEn, ru: nameRu },
    description: { en: "", ru: "" },
    durationMinutes: 60,
    priceEgp,
    priceRub: 0,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function mkBooking(
  title: string,
  status: string,
  start: string,
  eventTypeId = 1
): CalBooking {
  return {
    id: 1,
    uid: crypto.randomUUID(),
    title,
    status,
    start,
    end: start,
    duration: 60,
    eventTypeId,
    attendees: [{ name: "Client", email: "c@example.com", timeZone: "Africa/Cairo" }],
  };
}

// --- tiny RFC-4180 CSV parser (for the round-trip assertion) -----------------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // swallow — handled by the following \n
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Count PDF page objects (`/Type /Page` not `/Pages`). */
function countPdfPages(pdf: Buffer): number {
  const text = pdf.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page(?![s])/g);
  return matches ? matches.length : 0;
}
