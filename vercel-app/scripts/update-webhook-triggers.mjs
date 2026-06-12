#!/usr/bin/env node
/**
 * Idempotently update the trigger list of the Cal.com webhook that feeds
 * /api/cal/webhook so the branded attendee lifecycle emails fire for every
 * relevant event.
 *
 * Trigger findings (verified against the Cal v2 OpenAPI spec and cal.com
 * source, 2026-06):
 * - The full webhook trigger enum has NO BOOKING_CONFIRMED / BOOKING_ACCEPTED.
 * - When the host confirms a pending booking, Cal fires BOOKING_CREATED with
 *   status ACCEPTED (packages/features/bookings/lib/handleConfirmation.ts).
 * - Rejection fires BOOKING_REJECTED (with payload.rejectionReason);
 *   cancellation fires BOOKING_CANCELLED (with payload.cancellationReason).
 *
 * Desired triggers therefore:
 *   BOOKING_REQUESTED   → "request received" emails
 *   BOOKING_CREATED     → "request received" (pending) / "confirmed" (accepted)
 *   BOOKING_REJECTED    → decline email
 *   BOOKING_CANCELLED   → cancellation email
 *   BOOKING_RESCHEDULED → "appointment moved" email (payload carries the NEW
 *     booking plus rescheduleUid / rescheduleStartTime / rescheduleEndTime
 *     for the OLD one — see BookingRescheduledDTO in cal.com source)
 *
 * Usage:  node scripts/update-webhook-triggers.mjs   (run from vercel-app/)
 * Reads CALCOM_API_KEY / CALCOM_API_URL from the environment or .env.local.
 * PATCHes webhook WEBHOOK_ID, then GETs it back and verifies the trigger list.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const WEBHOOK_ID = process.env.WEBHOOK_ID || "9d37b7d5-9e84-423b-ac54-3f14a843bc27";
const DESIRED_TRIGGERS = [
  "BOOKING_REQUESTED",
  "BOOKING_CREATED",
  "BOOKING_REJECTED",
  "BOOKING_CANCELLED",
  "BOOKING_RESCHEDULED",
];

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

async function main() {
  console.log(`Cal API: ${API_URL}`);
  console.log(`Webhook: ${WEBHOOK_ID}`);

  const before = await cal("GET", `/webhooks/${WEBHOOK_ID}`);
  console.log(`Current triggers: ${JSON.stringify(before.triggers)}`);

  const alreadyOk =
    Array.isArray(before.triggers) &&
    DESIRED_TRIGGERS.every((t) => before.triggers.includes(t)) &&
    before.triggers.length === DESIRED_TRIGGERS.length;

  if (alreadyOk && before.active) {
    console.log("Triggers already match — nothing to do.");
  } else {
    await cal("PATCH", `/webhooks/${WEBHOOK_ID}`, {
      triggers: DESIRED_TRIGGERS,
      active: true,
    });
    console.log("PATCHed triggers.");
  }

  // Verify by GET-ing it back.
  const after = await cal("GET", `/webhooks/${WEBHOOK_ID}`);
  const missing = DESIRED_TRIGGERS.filter((t) => !after.triggers?.includes(t));
  console.log("Webhook after update:");
  console.log(
    JSON.stringify(
      {
        id: after.id,
        subscriberUrl: after.subscriberUrl,
        active: after.active,
        triggers: after.triggers,
        secret: after.secret ? "<set>" : "<missing>",
      },
      null,
      2
    )
  );
  if (missing.length) {
    throw new Error(`Verification FAILED — missing triggers: ${missing.join(", ")}`);
  }
  console.log("\nVerified: trigger list includes all desired triggers.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
