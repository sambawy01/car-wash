#!/usr/bin/env node
/**
 * Register (idempotently) the Cal.com webhook that notifies Victoria of new
 * booking requests via /api/cal/webhook.
 *
 * Usage:  node scripts/register-webhook.mjs   (run from vercel-app/)
 *
 * Reads CALCOM_API_KEY, CALCOM_API_URL and CAL_WEBHOOK_SECRET from .env.local.
 * Idempotent: lists existing webhooks first; if one already points at the
 * subscriber URL it is PATCHed, otherwise a new one is created.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUBSCRIBER_URL =
  "https://book.victoriaholisticbeauty.com/api/cal/webhook";
const TRIGGERS = ["BOOKING_REQUESTED", "BOOKING_CREATED", "BOOKING_CANCELLED"];

// --- env -------------------------------------------------------------------
function loadEnvLocal() {
  const envPath = join(__dirname, "..", ".env.local");
  const env = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = loadEnvLocal();
const API_KEY = process.env.CALCOM_API_KEY || env.CALCOM_API_KEY;
const API_URL =
  process.env.CALCOM_API_URL || env.CALCOM_API_URL || "https://api.cal.eu/v2";
const SECRET = process.env.CAL_WEBHOOK_SECRET || env.CAL_WEBHOOK_SECRET;

if (!API_KEY) {
  console.error("CALCOM_API_KEY missing (set it in vercel-app/.env.local)");
  process.exit(1);
}
if (!SECRET) {
  console.error(
    "CAL_WEBHOOK_SECRET missing (generate with `openssl rand -hex 32` and add to vercel-app/.env.local)"
  );
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
  console.log(`Subscriber URL: ${SUBSCRIBER_URL}`);

  const existing = await cal("GET", "/webhooks?take=100");
  const webhooks = Array.isArray(existing) ? existing : [];
  const match = webhooks.find((w) => w.subscriberUrl === SUBSCRIBER_URL);

  const desired = {
    subscriberUrl: SUBSCRIBER_URL,
    triggers: TRIGGERS,
    active: true,
    secret: SECRET,
  };

  let result;
  if (match) {
    console.log(`Webhook already exists (id=${match.id}) — updating...`);
    result = await cal("PATCH", `/webhooks/${match.id}`, desired);
  } else {
    console.log("No existing webhook for this URL — creating...");
    result = await cal("POST", "/webhooks", desired);
  }

  console.log("Cal returned:");
  console.log(
    JSON.stringify(
      { ...result, secret: result.secret ? "<set>" : undefined },
      null,
      2
    )
  );
  console.log(
    "\nNote: the endpoint 404s until the app is deployed — Cal will simply log failed deliveries until then."
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
