#!/usr/bin/env node
/**
 * QA tool: render EVERY email template the app can send and verify each HTML
 * body carries Victoria's branding (dark #0A1A2F band + white logo header).
 *
 * No emails are sent and no env is needed — the builders in src/lib are pure.
 * They are compiled with the project's TypeScript into .email-preview/ (git-
 * ignored) and rendered to .email-preview/out/*.{html,txt} for inspection.
 *
 * Usage:  node scripts/render-email-previews.mjs   (run from vercel-app/)
 * Exits non-zero if any rendered email is missing the logo band.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, "..");
const buildDir = join(appRoot, ".email-preview");
const outDir = join(buildDir, "out");

// --- compile the pure email libs ------------------------------------------------
rmSync(buildDir, { recursive: true, force: true });
execFileSync(
  "npx",
  [
    "tsc",
    "src/lib/booking-emails.ts",
    "src/lib/order-emails.ts",
    "src/lib/order-status-email.ts",
    "--outDir",
    ".email-preview",
    "--module",
    "commonjs",
    "--target",
    "es2022",
    "--moduleResolution",
    "node",
    "--esModuleInterop",
    "--skipLibCheck",
  ],
  { cwd: appRoot, stdio: "inherit" }
);

// tsc flattens output (rootDir is src/lib — every input lives there).
const require = createRequire(join(buildDir, "x.js"));
const bookingEmails = require(join(buildDir, "booking-emails.js"));
const orderEmails = require(join(buildDir, "order-emails.js"));
const orderStatusEmail = require(join(buildDir, "order-status-email.js"));

mkdirSync(outDir, { recursive: true });

// --- fixtures --------------------------------------------------------------------
const bookingBase = {
  uid: "preview-uid",
  service: "Facial Massage",
  start: "2026-07-01T13:00:00.000Z",
  durationMinutes: 90,
  status: "pending",
  attendeeName: "Anna Test",
  attendeeEmail: "anna@example.com",
  attendeePhone: "+201234567890",
  notes: "Treatments: Facial Massage 90 + Alginate Mask 30",
  lang: "en",
  reason: "",
};

const orderInput = (lang) => ({
  orderNumber: "VV-TEST01",
  name: lang === "ar" ? "Анна Тест" : "Anna Test",
  phone: "+201234567890",
  email: "anna@example.com",
  address: "12 Palm Hills, Cairo",
  note: "",
  lang,
  lines: [
    {
      nameEn: "Hydrating Serum",
      nameRu: "Увлажняющая сыворотка",
      qty: 2,
      lineEgp: 2400,
      lineRub: 6600,
    },
  ],
  totalEgp: 2400,
  totalRub: 6600,
});

const storedOrder = (lang) => ({
  orderNumber: "VV-TEST01",
  createdAt: "2026-06-12T10:00:00.000Z",
  status: "ordered",
  items: [
    {
      slug: "hydrating-serum",
      qty: 2,
      names: { en: "Hydrating Serum", ru: "Увлажняющая сыворотка" },
      lineTotals: { egp: 2400, rub: 6600 },
    },
  ],
  totals: { egp: 2400, rub: 6600 },
  name: lang === "ar" ? "Анна Тест" : "Anna Test",
  phone: "+201234567890",
  email: "anna@example.com",
  address: "12 Palm Hills, Cairo",
  note: "",
  lang,
  statusHistory: [{ status: "ordered", at: "2026-06-12T10:00:00.000Z" }],
});

// --- render everything -------------------------------------------------------------
const previews = [
  ["booking-owner-notification", bookingEmails.buildOwnerNotificationEmail(bookingBase)],
];

for (const lang of ["en", "ar"]) {
  previews.push([
    `booking-attendee-requested-${lang}`,
    bookingEmails.buildAttendeeEmail("requested", { ...bookingBase, lang }),
  ]);
  previews.push([
    `booking-attendee-confirmed-${lang}`,
    bookingEmails.buildAttendeeEmail("confirmed", {
      ...bookingBase,
      lang,
      status: "accepted",
    }),
  ]);
  previews.push([
    `booking-attendee-rejected-${lang}`,
    bookingEmails.buildAttendeeEmail("rejected", {
      ...bookingBase,
      lang,
      status: "rejected",
      reason: "Victoria is away that day — could we find another time?",
    }),
  ]);
  previews.push([
    `booking-attendee-cancelled-${lang}`,
    bookingEmails.buildAttendeeEmail("cancelled", {
      ...bookingBase,
      lang,
      status: "cancelled",
      reason: "Cancelled by the client",
    }),
  ]);
  previews.push([`order-buyer-confirmation-${lang}`, orderEmails.buildBuyerOrderEmail(orderInput(lang))]);
  for (const status of ["confirmed", "shipped", "delivered", "cancelled"]) {
    previews.push([
      `order-status-${status}-${lang}`,
      orderStatusEmail.buildOrderStatusEmail(
        storedOrder(lang),
        status,
        status === "cancelled" ? { code: "client-request" } : undefined
      ),
    ]);
  }
}
previews.push(["order-owner-notification", orderEmails.buildOwnerOrderEmail(orderInput("en"))]);

// --- verify the band -----------------------------------------------------------------
const BAND_MARKERS = [
  'bgcolor="#0A1A2F"',
  "https://eliteecocarwash.com/assets/logo-white.png",
];

let failures = 0;
console.log("\nTemplate".padEnd(42) + "logo band   subject");
console.log("-".repeat(110));
for (const [name, { subject, text, html }] of previews) {
  writeFileSync(join(outDir, `${name}.html`), html);
  writeFileSync(join(outDir, `${name}.txt`), `Subject: ${subject}\n\n${text}`);
  const hasBand = BAND_MARKERS.every((m) => html.includes(m));
  if (!hasBand) failures++;
  console.log(
    `${name.padEnd(42)}${hasBand ? "YES" : "MISSING"}${" ".repeat(hasBand ? 9 : 5)}${subject}`
  );
}

console.log(`\nRendered ${previews.length} emails to ${outDir}`);
if (failures) {
  console.error(`${failures} template(s) MISSING the logo band`);
  process.exit(1);
}
console.log("All templates carry the dark band + white logo header.");
