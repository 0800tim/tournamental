/**
 * HighLevel (GHL) contact upsert for register-interest signups.
 *
 * Same contract as lib/syndicate/ghl.ts: best-effort, 3 s timeout,
 * never blocks the user. The local row in register_interest is the
 * source of truth; GHL is the marketing mirror where Tim runs the
 * follow-up sequences.
 *
 * Tags: `register_interest`, `<slug>_interest` (e.g. rwc2027_interest),
 * `tournament:<tournament_id>`. Custom fields are prefixed
 * `interest_` so they can be created once in HL and reused for every
 * upcoming tournament. Unknown custom-field keys are ignored by GHL.
 */

import type { RegisterInterestRow } from "./store";

export type GhlStatus = "queued" | "synced" | "failed" | "skipped";

export interface GhlPushResult {
  status: GhlStatus;
  contactId?: string;
  error?: string;
}

const GHL_API_BASE_URL = (
  process.env.GHL_API_BASE_URL || "https://services.leadconnectorhq.com"
).replace(/\/+$/, "");
const GHL_VERSION_HEADER = "2021-07-28";
const GHL_PUSH_TIMEOUT_MS = 3_000;

export function buildRegisterInterestPayload(
  row: RegisterInterestRow,
  tagSlug: string,
  inviteBase: string,
): Record<string, unknown> {
  const tags = [
    "register_interest",
    `${tagSlug}_interest`,
    `tournament:${row.tournament_id}`,
  ];
  const body: Record<string, unknown> = {
    email: row.email,
    locationId: process.env.GHL_LOCATION_ID ?? "",
    tags,
    source: `${tagSlug}_register_interest`,
    customFields: [
      { key: "interest_tournament", field_value: row.tournament_id },
      { key: "interest_invite_code", field_value: row.invite_code },
      {
        key: "interest_invite_url",
        field_value: `${inviteBase}/i/${row.invite_code}`,
      },
      {
        key: "interest_referred_by",
        field_value: row.referred_by_code ?? "",
      },
      {
        key: "interest_registered_at",
        field_value: new Date(row.created_at).toISOString(),
      },
      { key: "interest_consent", field_value: row.consent ? "yes" : "no" },
    ],
  };
  if (row.first_name) body.firstName = row.first_name;
  if (row.phone) body.phone = row.phone;
  if (row.country) body.country = row.country;
  return body;
}

export async function pushRegisterInterestToGhl(
  row: RegisterInterestRow,
  opts: { tagSlug: string; inviteBase: string; fetchImpl?: typeof fetch },
): Promise<GhlPushResult> {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) return { status: "skipped" };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body = buildRegisterInterestPayload(row, opts.tagSlug, opts.inviteBase);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GHL_PUSH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${GHL_API_BASE_URL}/contacts/upsert`, {
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
      return { status: "failed", error: `ghl ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json().catch(() => ({}))) as {
      contact?: { id?: string };
    };
    return { status: "synced", contactId: json.contact?.id };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}
