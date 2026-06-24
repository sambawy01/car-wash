import { getTreatmentsCatalog, type Treatment } from "../treatments";

/**
 * Weekly Cal.com drift check (/api/cron/cal-sync-check, Monday 09:00 Cairo).
 *
 * The treatments catalog (Blob) is the source of truth; the admin routes
 * best-effort sync changes to Cal event types. Best-effort means drift CAN
 * accumulate (Cal outage during a save, manual edits in the Cal dashboard).
 * This job verifies, for every treatment in the catalog, READ-ONLY against
 * api.cal.eu (cal-api-version 2024-06-14, same as the admin sync helpers):
 *
 * - active treatments: linked eventTypeId exists, title === name.en,
 *   lengthInMinutes === durationMinutes, hidden === false
 * - deactivated treatments with a linked event type: hidden === true
 * - active treatments with NO linked event type (eventTypeId 0) are drift —
 *   they can never be booked.
 *
 * ALERT POLICY: confirmed drift → Telegram + email alert listing every
 * mismatch. Clean → completely silent (no email, no Telegram — a weekly
 * "all good" is noise). Transient per-event-type fetch errors (non-404) are
 * reported as `errors` in the route response and the Actions log, but never
 * page the team — only CONFIRMED drift alerts.
 */

const EVENT_TYPES_API_VERSION = "2024-06-14";
const CAL_FETCH_TIMEOUT_MS = 12_000;

export interface CalDriftItem {
  slug: string;
  eventTypeId: number;
  problem: string;
}

export interface CalSyncCheckResult {
  /**
   * Treatments whose verification CONCLUDED — clean, drifted, or 404 (a
   * confirmed-missing event type IS a verdict). Treatments whose Cal fetch
   * failed transiently are counted in `errors`, never here.
   */
  checked: number;
  /** Catalog entries skipped (deactivated with no linked event type). */
  skipped: number;
  drift: CalDriftItem[];
  /** Transient fetch failures — logged, never alerted. */
  errors: string[];
}

interface CalEventType {
  id: number;
  title?: string;
  lengthInMinutes?: number;
  hidden?: boolean;
}

async function fetchEventType(
  apiUrl: string,
  apiKey: string,
  eventTypeId: number
): Promise<
  | { ok: true; eventType: CalEventType }
  | { ok: false; notFound: true }
  | { ok: false; notFound: false; error: string }
> {
  const res = await fetch(`${apiUrl}/event-types/${eventTypeId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "cal-api-version": EVENT_TYPES_API_VERSION,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(CAL_FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) return { ok: false, notFound: true };
  const json = (await res.json().catch(() => ({}))) as {
    status?: string;
    data?: CalEventType;
  };
  if (!res.ok || json.status !== "success" || !json.data) {
    return {
      ok: false,
      notFound: false,
      error: `GET /event-types/${eventTypeId} -> ${res.status}: ${JSON.stringify(json).slice(0, 200)}`,
    };
  }
  return { ok: true, eventType: json.data };
}

function checkOne(t: Treatment, et: CalEventType): CalDriftItem[] {
  const drift: CalDriftItem[] = [];
  const expectHidden = !t.active;
  if (t.active && et.title !== t.name.en) {
    drift.push({
      slug: t.slug,
      eventTypeId: t.eventTypeId,
      problem: `title mismatch: Cal "${et.title}" vs catalog "${t.name.en}"`,
    });
  }
  if (t.active && et.lengthInMinutes !== t.durationMinutes) {
    drift.push({
      slug: t.slug,
      eventTypeId: t.eventTypeId,
      problem: `duration mismatch: Cal ${et.lengthInMinutes}min vs catalog ${t.durationMinutes}min`,
    });
  }
  if (Boolean(et.hidden) !== expectHidden) {
    drift.push({
      slug: t.slug,
      eventTypeId: t.eventTypeId,
      problem: t.active
        ? "event type is HIDDEN on Cal but the treatment is active (not bookable!)"
        : "event type is VISIBLE on Cal but the treatment is deactivated",
    });
  }
  return drift;
}

/** Read-only drift check of the whole catalog. Throws if catalog/env unavailable. */
export async function checkCalSync(): Promise<CalSyncCheckResult> {
  const apiUrl = process.env.CALCOM_API_URL;
  const apiKey = process.env.CALCOM_API_KEY;
  if (!apiUrl || !apiKey) {
    throw new Error(
      "Cal.com API is not configured (CALCOM_API_URL / CALCOM_API_KEY)"
    );
  }

  const treatments = await getTreatmentsCatalog();

  const drift: CalDriftItem[] = [];
  const errors: string[] = [];
  let checked = 0;
  let skipped = 0;

  // 11-ish entries — full concurrency is fine for read-only GETs.
  await Promise.all(
    treatments.map(async (t) => {
      if (t.eventTypeId <= 0) {
        if (t.active) {
          drift.push({
            slug: t.slug,
            eventTypeId: 0,
            problem: "active treatment has no linked Cal event type",
          });
          checked++;
        } else {
          skipped++;
        }
        return;
      }
      try {
        const result = await fetchEventType(apiUrl, apiKey, t.eventTypeId);
        if (result.ok) {
          checked++;
          drift.push(...checkOne(t, result.eventType));
        } else if (result.notFound) {
          checked++;
          drift.push({
            slug: t.slug,
            eventTypeId: t.eventTypeId,
            problem: "event type not found on Cal (404)",
          });
        } else {
          // Verification did NOT conclude — `errors`, not `checked`.
          errors.push(`${t.slug}: ${result.error}`);
        }
      } catch (error) {
        errors.push(
          `${t.slug}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    })
  );

  drift.sort((a, b) => a.slug.localeCompare(b.slug));
  return { checked, skipped, drift, errors };
}

/** Plain-text alert body shared by Telegram and the email text part. */
export function driftAlertText(result: CalSyncCheckResult): string {
  const lines = [
    "CAL SYNC DRIFT DETECTED",
    "",
    `The weekly check found ${result.drift.length} mismatch${result.drift.length === 1 ? "" : "es"} between the treatments catalog and Cal.com:`,
    "",
  ];
  for (const d of result.drift) {
    lines.push(`- ${d.slug} (event type ${d.eventTypeId || "none"}): ${d.problem}`);
  }
  if (result.errors.length) {
    lines.push(
      "",
      `Also ${result.errors.length} treatment(s) could not be verified (transient Cal errors):`
    );
    for (const e of result.errors) lines.push(`- ${e}`);
  }
  lines.push(
    "",
    "Fix from the treatments admin (re-saving a treatment re-syncs its Cal event type), or adjust the event type on Cal.com."
  );
  return lines.join("\n");
}
