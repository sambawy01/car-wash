#!/usr/bin/env node
/**
 * Investigate / apply disabling of Cal.com's own generic attendee emails so
 * clients only receive Victoria's branded ones (sent by /api/cal/webhook).
 *
 * What the Cal v2 API spec says (docs/api-reference/v2/openapi.json, 2026-06):
 * - `EmailSettings_2024_06_14` ({ disableEmailsToAttendees,
 *   disableEmailsToHosts }) is referenced ONLY by `TeamEventTypeOutput` —
 *   i.e. it is a TEAM event type feature and OUTPUT-only in the spec.
 * - User (personal) Create/UpdateEventTypeInput_2024_06_14 has NO email
 *   switch and no `metadata` passthrough, so the internal
 *   `metadata.disableStandardEmails` flag (which additionally requires an
 *   active workflow — a paid feature) cannot be set through the public API.
 *
 * This script verifies that empirically against ONE sacrificial event type
 * before touching anything real:
 *
 *   node scripts/disable-cal-emails.mjs                 # experiment on 327542
 *   node scripts/disable-cal-emails.mjs --apply-all     # if (and only if) the
 *       experiment verifies, apply to every other event type (idempotent)
 *
 * The experiment PATCHes the test event type with emailSettings, GETs it back
 * and checks whether the setting persisted. If Cal ignores or rejects the
 * field, it reports "NOT POSSIBLE on this plan" and exits non-zero without
 * touching the real event types.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The secret 15-min test event type — never one of the 13 real services. */
const TEST_EVENT_TYPE_ID = Number(process.env.TEST_EVENT_TYPE_ID || 327542);
const APPLY_ALL = process.argv.includes("--apply-all");

const DESIRED_EMAIL_SETTINGS = {
  disableEmailsToAttendees: true,
  disableEmailsToHosts: false, // Victoria still gets Cal's host emails
};

// --- env -------------------------------------------------------------------
function loadEnvLocal() {
  const envPath = join(__dirname, "..", ".env.local");
  const env = {};
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?\s*$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch {
    // no .env.local — rely on process.env
  }
  return env;
}

const env = loadEnvLocal();
const API_KEY = process.env.CALCOM_API_KEY || env.CALCOM_API_KEY;
const API_URL =
  process.env.CALCOM_API_URL || env.CALCOM_API_URL || "https://api.cal.eu/v2";

if (!API_KEY) {
  console.error("CALCOM_API_KEY missing (set it in vercel-app/.env.local or the environment)");
  process.exit(1);
}

const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  "cal-api-version": "2024-06-14",
  "Content-Type": "application/json",
};

/** Raw call — the experiment needs to inspect non-success responses too. */
async function calRaw(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { httpStatus: res.status, json };
}

async function cal(method, path, body) {
  const { httpStatus, json } = await calRaw(method, path, body);
  if (httpStatus >= 400 || json.status !== "success") {
    throw new Error(
      `${method} ${path} -> ${httpStatus}: ${JSON.stringify(json).slice(0, 500)}`
    );
  }
  return json.data;
}

function emailSettingsOf(eventType) {
  return (
    eventType?.emailSettings ?? eventType?.metadata?.disableStandardEmails ?? null
  );
}

async function experiment() {
  console.log(`Cal API: ${API_URL}`);
  console.log(`Experimenting on TEST event type ${TEST_EVENT_TYPE_ID} (never a real one)\n`);

  const before = await cal("GET", `/event-types/${TEST_EVENT_TYPE_ID}`);
  console.log(
    `[before] slug=${before.slug} emailSettings=${JSON.stringify(emailSettingsOf(before))}`
  );

  // Attempt 1: documented team-event field `emailSettings`.
  const attempt1 = await calRaw("PATCH", `/event-types/${TEST_EVENT_TYPE_ID}`, {
    emailSettings: DESIRED_EMAIL_SETTINGS,
  });
  console.log(
    `[attempt emailSettings] PATCH -> ${attempt1.httpStatus}: ${JSON.stringify(attempt1.json).slice(0, 300)}`
  );

  // Attempt 2: internal metadata.disableStandardEmails passthrough.
  const attempt2 = await calRaw("PATCH", `/event-types/${TEST_EVENT_TYPE_ID}`, {
    metadata: {
      disableStandardEmails: { all: { attendee: true, host: false } },
    },
  });
  console.log(
    `[attempt metadata.disableStandardEmails] PATCH -> ${attempt2.httpStatus}: ${JSON.stringify(attempt2.json).slice(0, 300)}`
  );

  // Inspect what actually persisted.
  const after = await cal("GET", `/event-types/${TEST_EVENT_TYPE_ID}`);
  const persisted = emailSettingsOf(after);
  console.log(`\n[after]  emailSettings=${JSON.stringify(persisted)}`);

  const works =
    persisted &&
    (persisted.disableEmailsToAttendees === true ||
      persisted.all?.attendee === true);

  if (!works) {
    console.error(
      "\nRESULT: disabling Cal's attendee emails is NOT possible for this " +
        "event type/plan via the v2 API (setting did not persist). " +
        "Clients will receive Cal's generic emails ALONGSIDE the branded ones."
    );
    process.exit(2);
  }

  console.log("\nRESULT: emailSettings persisted — disabling attendee emails WORKS.");
  return true;
}

async function applyAll() {
  const all = await cal("GET", "/event-types");
  const targets = all.filter((et) => et.id !== TEST_EVENT_TYPE_ID);
  console.log(`\nApplying to ${targets.length} event types...`);
  for (const et of targets) {
    const current = emailSettingsOf(et);
    if (current?.disableEmailsToAttendees === true) {
      console.log(`ok       ${et.slug} (id ${et.id}) — already disabled`);
      continue;
    }
    await cal("PATCH", `/event-types/${et.id}`, {
      emailSettings: DESIRED_EMAIL_SETTINGS,
    });
    const check = await cal("GET", `/event-types/${et.id}`);
    const verified =
      emailSettingsOf(check)?.disableEmailsToAttendees === true;
    console.log(
      `${verified ? "patched " : "FAILED  "} ${et.slug} (id ${et.id})`
    );
    if (!verified) {
      throw new Error(`verification failed for event type ${et.id}`);
    }
  }
  console.log("\nAll event types updated and verified.");
}

async function main() {
  await experiment();
  if (APPLY_ALL) {
    await applyAll();
  } else {
    console.log(
      "\n(Dry experiment only — re-run with --apply-all to roll out to all event types.)"
    );
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
