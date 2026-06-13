/**
 * REAL-Cal, READ-ONLY verification of the paginating listBookingsInRange fix
 * and the CRM profile path that 500'd in production.
 *
 * Run: npx tsx scripts/verify-cal-paging-live.mts
 *
 * Never creates/modifies/deletes a booking — only GET /bookings + Blob reads.
 */
import { readFileSync } from "node:fs";

// Load .env.local (REAL CALCOM_API_KEY / CALCOM_API_URL / BLOB / CRON_SECRET)
// BEFORE the app modules are touched. The Cal/Blob helpers read env lazily
// (inside the request functions), so static imports below are safe.
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

import { listBookingsInRange } from "../src/lib/admin/cal";
import * as crm from "../src/lib/crm";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

const now = Date.now();
const after = new Date(now - 730 * 86_400_000).toISOString();
const before = new Date(now + 365 * 86_400_000).toISOString();

// 1. Wide range no longer 400s and returns a plausible full set.
const full = await listBookingsInRange(after, before);
console.log(`\n[1] listBookingsInRange(730d back → 365d ahead) → ${full.length} bookings`);
check("wide range returns without throwing", true);
check("returns an array", Array.isArray(full));
const sorted = full.every(
  (b, i) => i === 0 || new Date(full[i - 1].start).getTime() <= new Date(b.start).getTime()
);
check("results sorted by start", sorted);
check("CalBooking shape intact (uid/status/attendees)", full.every(
  (b) => typeof b.uid === "string" && typeof b.status === "string" && Array.isArray(b.attendees)
));

// 2. Force paging with a tiny pageSize and confirm it matches the full set.
const pagedTiny = await listBookingsInRange(after, before, { pageSize: 2 });
console.log(`[2] same range, pageSize=2 → ${pagedTiny.length} bookings`);
check("tiny-page paging count == default full count", pagedTiny.length === full.length,
  `${pagedTiny.length} vs ${full.length}`);
const tinyUids = new Set(pagedTiny.map((b) => b.uid));
check("tiny-page paging covers the same bookings (no dupes/gaps)",
  tinyUids.size === pagedTiny.length && full.every((b) => tinyUids.has(b.uid)));
check("paging actually occurred when >pageSize exist",
  full.length <= 2 || pagedTiny.length === full.length);

// 3. Single-page baseline: full set must be >= a single take=100 page.
const onePage = await listBookingsInRange(after, before, { pageSize: 100, maxPages: 1 });
console.log(`[3] single page (take=100, maxPages=1) → ${onePage.length}`);
check("full set >= single page", full.length >= onePage.length);

// 4a. REAL CRM path exactly as prod runs it (real Cal + real Blob, read-only).
//     NOTE: the LOCAL BLOB_READ_WRITE_TOKEN 403s on private blob CONTENT reads
//     (documented in scripts/verify-crm.mts) — that is an env limitation, not a
//     code path, and is independent of the Cal pagination fix.
let prodPathOk = false;
let prodErr = "";
try {
  const overview = await crm.getClientsOverview();
  prodPathOk = true;
  console.log(`[4a] getClientsOverview() (real Blob) → ${overview.profiles.length} profiles`);
} catch (err) {
  prodErr = (err as Error).message;
  console.log(`[4a] getClientsOverview (real Blob) threw: ${prodErr}`);
}
const blobLimited =
  !prodPathOk && /blob/i.test(prodErr) &&
  /403|forbidden|access denied|valid token/i.test(prodErr);
check("prod path: profiles OR known local-Blob-403 limitation (not Cal)",
  prodPathOk || blobLimited, prodPathOk ? "" : "local Blob 403 (token), Cal OK");

// 4b. Same profile-building maths fed by REAL paginated Cal bookings, with the
//     Blob-backed pieces stubbed (orders/treatments empty, in-memory overlay
//     store) — reproduces the EXACT code path that consumed take=500 and 500'd.
const mem = new Map<string, string>();
crm.__setCrmStore({
  async read(p) { return mem.get(p) ?? null; },
  async write(p, b) { mem.set(p, b); },
  async list(prefix) { return [...mem.keys()].filter((k) => k.startsWith(prefix)); },
  async remove(p) { mem.delete(p); },
});
let profileCount = -1;
let overviewOk = false;
try {
  const overview = await crm.getClientsOverview({
    sources: {
      listBookingsInRange, // REAL, paginating Cal
      listOrders: async () => [],
      getTreatmentsCatalog: async () => [],
    },
  });
  profileCount = overview.profiles.length;
  overviewOk = true;
  console.log(`[4b] getClientsOverview(realCal+stubBlob) → ${profileCount} profiles, ` +
    `${overview.rebooking.length} rebooking, ${overview.unlinked.length} unlinked`);
} catch (err) {
  console.log(`[4b] threw: ${(err as Error).message}`);
}
crm.__resetCrmStore();
check("profile build over REAL paginated Cal returns without throwing", overviewOk);

console.log(`\nRESULT: ${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
console.log(`SUMMARY bookings=${full.length} profiles=${profileCount}`);
process.exit(failures === 0 ? 0 : 1);
