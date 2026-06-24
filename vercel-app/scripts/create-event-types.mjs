#!/usr/bin/env node
/**
 * One-off script: create/update the 6 per-service Cal.com event types
 * for Elite Eco Car Wash, all with owner confirmation
 * required (confirmationPolicy: always).
 *
 * Usage:  node scripts/create-event-types.mjs   (run from vercel-app/)
 *
 * Reads CALCOM_API_KEY and CALCOM_API_URL from .env.local — no secrets here.
 * Idempotent: existing slugs are PATCHed instead of duplicated.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- env -------------------------------------------------------------------
function loadEnvLocal() {
  const envPath = join(__dirname, "..", ".env.local");
  const env = {};
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch (e) {
    // .env.local may not exist yet — that's fine, we fall back to process.env
  }
  return env;
}

const env = loadEnvLocal();
const API_KEY = process.env.CALCOM_API_KEY || env.CALCOM_API_KEY;
const API_URL =
  process.env.CALCOM_API_URL || env.CALCOM_API_URL || "https://api.cal.com/v2";

if (!API_KEY) {
  console.error("CALCOM_API_KEY missing (set it in vercel-app/.env.local)");
  process.exit(1);
}

const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  "cal-api-version": "2024-06-14",
  "Content-Type": "application/json",
};

async function cal(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status !== "success") {
    throw new Error(
      `${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 500)}`
    );
  }
  return json.data;
}

// --- the 6 services ---------------------------------------------------------
const CONFIRMATION = { type: "always", blockUnconfirmedBookingsInBooker: false };
const LOCATIONS = [{ type: "attendeeAddress" }];

const SERVICES = [
  {
    slug: "interior-exterior-wash",
    title: "Interior & Exterior Wash",
    durations: [60, 75],
    description: "Complete interior vacuum, dashboard cleaning, and exterior foam wash with hot wax — E£320 (60m) · E£370 (75m)",
  },
  {
    slug: "wheel-cleaning",
    title: "Wheel Cleaning",
    durations: [30],
    description: "Deep cleaning for alloy wheels, tires, and wheel arches — E£140",
  },
  {
    slug: "engine-cleaning",
    title: "Engine Cleaning",
    durations: [30],
    description: "Safe engine bay degreasing and dressing — E£230",
  },
  {
    slug: "polishing-protection",
    title: "Polishing & Protection",
    durations: [90],
    description: "Machine polishing with protective wax coating for long-lasting shine — E£700",
  },
  {
    slug: "steam-cleaning",
    title: "Steam Cleaning",
    durations: [60],
    description: "Sanitizing steam clean for interior surfaces and upholstery — E£330",
  },
  {
    slug: "waterless-wash",
    title: "Waterless Wash",
    durations: [45],
    description: "Eco-friendly waterless wash using premium spray products — E£220",
  },
];

// --- main --------------------------------------------------------------------
function payloadFor(svc) {
  const longest = Math.max(...svc.durations);
  const payload = {
    title: svc.title,
    slug: svc.slug,
    lengthInMinutes: longest,
    description: svc.description,
    locations: LOCATIONS,
    confirmationPolicy: CONFIRMATION,
  };
  if (svc.durations.length > 1) {
    payload.lengthInMinutesOptions = svc.durations;
  }
  return payload;
}

async function main() {
  const existing = await cal("GET", "/event-types");
  const bySlug = new Map(existing.map((et) => [et.slug, et]));

  const results = [];

  for (const svc of SERVICES) {
    const payload = payloadFor(svc);
    const found = bySlug.get(svc.slug);
    let id;
    if (found) {
      const { slug: _slug, ...patch } = payload;
      const updated = await cal("PATCH", `/event-types/${found.id}`, patch);
      id = updated.id;
      console.log(`updated  ${svc.slug} (id ${id})`);
    } else {
      const created = await cal("POST", "/event-types", payload);
      id = created.id;
      console.log(`created  ${svc.slug} (id ${id})`);
    }

    const check = await cal("GET", `/event-types/${id}`);
    const confirmOk = check.confirmationPolicy?.type === "always";
    const durations = check.lengthInMinutesOptions ?? [check.lengthInMinutes];
    const durationsOk =
      JSON.stringify([...durations].sort((a, b) => a - b)) ===
      JSON.stringify([...svc.durations].sort((a, b) => a - b));
    const slugOk = check.slug === svc.slug;
    if (!confirmOk || !durationsOk || !slugOk) {
      throw new Error(
        `verification failed for ${svc.slug}: slug=${check.slug} durations=${durations} confirmationPolicy=${JSON.stringify(check.confirmationPolicy)}`
      );
    }
    results.push({ slug: svc.slug, id, durations, confirmation: check.confirmationPolicy.type });
  }

  console.log("\nslug -> id (verified: slug, durations, confirmation=always)");
  console.log("-".repeat(64));
  for (const r of results) {
    console.log(
      `${r.slug.padEnd(30)} ${String(r.id).padEnd(8)} [${r.durations.join(", ")}m]`
    );
  }

  console.log("\n--- Update services.ts and treatments.ts with these eventTypeId values ---");
  for (const r of results) {
    console.log(`  ${r.slug}: ${r.id}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});