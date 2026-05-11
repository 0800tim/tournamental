/**
 * GoHighLevel (GHL) contact-creation helper for the syndicate-signup
 * funnel.
 *
 * What it does: forwards owner contact details + custom fields to
 * GHL's v2 REST API (`POST /contacts/`) and tags the contact as
 * `syndicate_owner`. The tag is what drips / automations in GHL hang
 * off.
 *
 * What it does NOT do: block the user-facing signup. The route wraps
 * this call in try/catch with a 3-second timeout; failures are written
 * to the `syndicates_pending_ghl` retry queue and the user still gets
 * a syndicate.
 *
 * The route at `apps/crm-bridge` already wraps a richer GHL client for
 * the rest of the lifecycle (predictions, ranks, settlement). This
 * lighter call is duplicated here because:
 *
 *   - The launch goal is "marketing acquires syndicate owners during
 *     the launch hype window" — coupling the public signup to the
 *     crm-bridge service availability would block us on its uptime.
 *   - The contact payload here is a single immutable upsert; the rich
 *     client elsewhere needs many more dependencies (humanness, ranks).
 *   - Post-launch we'll migrate this caller to the crm-bridge HTTP
 *     interface and delete this file — leave a TODO at the call site.
 */

import type { SyndicateRow } from "./persistence";

export type GhlStatus = "queued" | "synced" | "failed" | "skipped";

export interface GhlPushResult {
  status: GhlStatus;
  /** GHL contact id on success. */
  contactId?: string;
  /** Diagnostic only — never sent to the client. */
  error?: string;
}

const GHL_API_BASE_URL =
  process.env.GHL_API_BASE_URL ?? "https://services.leadconnectorhq.com";
const GHL_VERSION_HEADER = "2021-07-28";
const GHL_PUSH_TIMEOUT_MS = 3_000;

/**
 * Map a syndicate row to the GHL contact payload. Kept pure so tests
 * can assert on the exact custom-field shape without spinning a server.
 *
 * Custom-field keys mirror the conventions in `apps/crm-bridge` so we
 * have one consistent vocabulary across services:
 *
 *   - `syndicate_slug`       — kebab slug of the syndicate
 *   - `syndicate_role`       — "owner" | "member"
 *   - `syndicate_tournament` — tournament id (e.g. `fifa-wc-2026`)
 *
 * Tags applied: `["syndicate_owner"]` plus a tournament-scoped tag for
 * segment-level workflows in GHL.
 */
export function buildGhlContactPayload(row: SyndicateRow): {
  body: Record<string, unknown>;
  tags: string[];
} {
  const tournamentTag = `tournament:${row.tournament_id}`;
  return {
    body: {
      email: row.owner_email,
      phone: row.owner_phone,
      locationId: process.env.GHL_LOCATION_ID ?? "",
      tags: ["syndicate_owner", tournamentTag],
      source: "syndicate_signup",
      customFields: [
        { key: "syndicate_slug", field_value: row.slug },
        { key: "syndicate_role", field_value: "owner" },
        { key: "syndicate_tournament", field_value: row.tournament_id },
      ],
    },
    tags: ["syndicate_owner", tournamentTag],
  };
}

/**
 * Push a syndicate owner to GHL. Returns:
 *   - `skipped` when GHL_API_KEY is unset (dev / preview). Caller
 *      logs a warning and proceeds — never blocks the user.
 *   - `synced`  on a 2xx response.
 *   - `failed`  on timeout / non-2xx / network error. Caller enqueues
 *      the payload for the daily retry cron and still responds 200.
 *
 * Why not throw on failure: see the file header. Marketing wins the
 * tournament hype window; the CRM eventually-catches-up is fine.
 */
export async function pushToGhl(
  row: SyndicateRow,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<GhlPushResult> {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) {
    return { status: "skipped" };
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? GHL_PUSH_TIMEOUT_MS;
  const { body } = buildGhlContactPayload(row);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(`${GHL_API_BASE_URL}/contacts/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: GHL_VERSION_HEADER,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        status: "failed",
        error: `ghl ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const json = (await res.json().catch(() => ({}))) as {
      contact?: { id?: string };
      id?: string;
    };
    const contactId = json.contact?.id ?? json.id;
    return { status: "synced", contactId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "failed", error: message };
  } finally {
    clearTimeout(timer);
  }
}
