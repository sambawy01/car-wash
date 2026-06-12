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
import type { LedgerStore, LedgerEntry } from "../src/lib/finance";
import type { PnLInputs } from "../src/lib/finance-report";

// --- in-memory ledger store --------------------------------------------------
function makeMemoryStore(): LedgerStore & { dump(): Map<string, string> } {
  const map = new Map<string, string>();
  return {
    async read(pathname: string) {
      return map.has(pathname) ? map.get(pathname)! : null;
    },
    async write(pathname: string, body: string) {
      map.set(pathname, body);
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
console.log("\n=== 2. Read-error semantics (throws on transient, [] on 404, throws on corrupt) ===");
{
  // true 404 → []
  __setLedgerStore({
    async read() {
      return null;
    },
    async write() {},
  });
  check("read()=null (true 404) → []", (await listLedger()).length === 0);

  // transient read failure → THROWS (never read as empty by a writer)
  __setLedgerStore({
    async read() {
      throw new Error("simulated transient blob 500");
    },
    async write() {},
  });
  let threw = false;
  try {
    await listLedger();
  } catch {
    threw = true;
  }
  check("transient read error → listLedger THROWS", threw);

  // corrupt (not an array) → THROWS
  __setLedgerStore({
    async read() {
      return JSON.stringify({ not: "an array" });
    },
    async write() {},
  });
  let corruptThrew = false;
  try {
    await listLedger();
  } catch {
    corruptThrew = true;
  }
  check("corrupt blob (not array) → listLedger THROWS", corruptThrew);

  // malformed entry → THROWS
  __setLedgerStore({
    async read() {
      return JSON.stringify([{ id: "x", date: "nope" }]);
    },
    async write() {},
  });
  let malformedThrew = false;
  try {
    await listLedger();
  } catch {
    malformedThrew = true;
  }
  check("malformed entry → listLedger THROWS", malformedThrew);
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
    mkTreatment("facial-massage", "Facial Massage", 3350),
    mkTreatment("hydrofacial", "HydroFacial + Ultrasonic Cleaning", 3700),
  ];
  const bookings: CalBooking[] = [
    mkBooking("Facial Massage between Victoria and A", "accepted", "2026-06-08T09:00:00.000Z"),
    mkBooking("Facial Massage between Victoria and B", "accepted", "2026-06-15T09:00:00.000Z"),
    mkBooking("HydroFacial + Ultrasonic Cleaning between Victoria and C", "accepted", "2026-06-18T09:00:00.000Z"),
    mkBooking("Facial Massage between Victoria and D", "pending", "2026-06-19T09:00:00.000Z"), // not confirmed
    mkBooking("Mystery Service between Victoria and E", "accepted", "2026-06-20T09:00:00.000Z"), // no catalog match
    mkBooking("Facial Massage between Victoria and F", "accepted", "2026-07-02T09:00:00.000Z"), // out of range
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

function mkTreatment(slug: string, nameEn: string, priceEgp: number): Treatment {
  return {
    slug,
    eventTypeId: 1,
    name: { en: nameEn, ru: nameEn },
    description: { en: "", ru: "" },
    durationMinutes: 60,
    priceEgp,
    priceRub: 0,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function mkBooking(title: string, status: string, start: string): CalBooking {
  return {
    id: 1,
    uid: crypto.randomUUID(),
    title,
    status,
    start,
    end: start,
    duration: 60,
    eventTypeId: 1,
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
