/**
 * HighLevel (GoHighLevel) contact sync for the auth service.
 *
 * Every registered user is mirrored into HighLevel as a contact tagged
 * `player` the moment we learn their phone (first sign-in) or email, and
 * re-synced whenever they edit their profile. The contact's HighLevel id
 * is written back onto the `user` row (`highlevel_contact_id`) so later
 * syncs upsert the same record.
 *
 * Design rules:
 *   - Best-effort + fire-and-forget. This never blocks login and never
 *     throws into the request path — failures are logged, not surfaced.
 *   - Idempotent. We call `POST /contacts/upsert` (create-or-merge by
 *     email/phone), so retries and re-syncs never create duplicates.
 *   - Config-gated. With `GHL_API_KEY` unset (dev / test / preview) every
 *     call short-circuits to `skipped` and makes no network request.
 *
 * Why this lives in auth-sms and not crm-bridge: auth-sms owns the
 * canonical identity row (phone / email / name) and the
 * `highlevel_contact_id` / `highlevel_synced_at` columns. crm-bridge
 * owns the richer lifecycle (predictions, ranks, settlement). This module
 * only mirrors identity. See docs/23-highlevel-integration.md.
 *
 * Custom fields (created by `scripts/highlevel-setup.ts`):
 *   - `vtourn_user_id`   — our internal user id, links contact ↔ user.
 *   - `vtourn_admin_url` — deep link into the admin dashboard for this user.
 * Unknown custom-field keys are silently ignored by GHL (verified), so
 * sending these before the fields exist is harmless.
 */

import type { Storage, UserRecord } from './storage.js';

const DEFAULT_BASE_URL = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';
const SYNC_TIMEOUT_MS = 4_000;

/** Tag applied to every registered user. */
export const PLAYER_TAG = 'player';

export type SyncStatus = 'synced' | 'skipped' | 'failed';

export interface SyncResult {
  status: SyncStatus;
  /** HighLevel contact id on success. */
  contactId?: string;
  /** Diagnostic only; never returned to a client. */
  error?: string;
}

interface SyncLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
}

/** True when the GHL credentials are present and the sync is live. */
export function isHighLevelConfigured(): boolean {
  return Boolean(process.env.GHL_API_KEY && process.env.GHL_LOCATION_ID);
}

/**
 * Reject obviously-bogus phone numbers (repeated or sequential test digits
 * like `+1 333 333 3333`) so they don't pollute HighLevel. Deliberately
 * conservative: it only filters egregious fakes and never a plausible real
 * number, because real numbers are valuable — we message players via the
 * Aiva SMS / WhatsApp gateway wired into HighLevel.
 */
export function isPlausiblePhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return false; // E.164 bounds
  if (new Set(digits).size <= 2) return false; // 3333333333, 1212121212, …
  if (/(\d)\1{6,}/.test(digits)) return false; // 7+ identical digits in a row
  if (/0123456789|1234567890|9876543210/.test(digits)) return false; // sequential
  return true;
}

function baseUrl(): string {
  // `||` not `??`: the deployed env sometimes sets this present-but-empty,
  // and `""` must fall back to the default rather than yield a relative URL.
  const raw = process.env.GHL_API_BASE_URL;
  return (raw && raw.trim() ? raw.trim() : DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/**
 * Deep link from a HighLevel contact into our admin dashboard for the
 * given user. The dashboard itself is a future build (see
 * docs/24-admin-dashboard.md); the link contract is fixed now so the
 * custom field is populated from day one.
 */
export function adminUserUrl(userId: string): string {
  const base = (
    process.env.ADMIN_DASHBOARD_URL || 'https://play.tournamental.com/admin'
  ).replace(/\/+$/, '');
  return `${base}/users/${encodeURIComponent(userId)}`;
}

/**
 * Map a user row to the GHL upsert body. Only fields we actually hold are
 * sent; GHL derives `country` from the phone when we omit it. Kept pure
 * for unit testing the payload shape without a server.
 */
export function buildContactBody(
  user: UserRecord,
  locationId: string,
): Record<string, unknown> {
  const customFields: Array<{ key: string; field_value: string }> = [
    { key: 'vtourn_user_id', field_value: user.id },
    { key: 'vtourn_admin_url', field_value: adminUserUrl(user.id) },
  ];

  const body: Record<string, unknown> = {
    locationId,
    source: 'tournamental_registration',
    tags: [PLAYER_TAG],
    customFields,
  };

  // Only send a phone that passes the bogus-number filter; a junk number
  // is dropped rather than written (the contact is still created off email
  // if present).
  if (isPlausiblePhone(user.phone)) body.phone = user.phone;
  if (user.email) body.email = user.email;
  if (user.first_name) body.firstName = user.first_name;
  if (user.last_name) body.lastName = user.last_name;
  // `name` is the contact's display name in GHL; prefer our display_name,
  // falling back to first/last so the contact never shows up blank.
  if (user.display_name) {
    body.name = user.display_name;
  } else if (user.first_name || user.last_name) {
    body.name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  }
  if (user.country) body.country = user.country;

  return body;
}

/**
 * Upsert a user into HighLevel. Returns `skipped` when unconfigured or
 * when the user has neither phone nor email (GHL needs at least one). Does
 * not write anything back to the DB — see {@link syncUserToHighLevel} for
 * the persisting wrapper.
 */
export async function upsertContact(
  user: UserRecord,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; extraTags?: readonly string[] } = {},
): Promise<SyncResult> {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) return { status: 'skipped' };
  // Need at least one usable contact handle: a plausible phone OR an email.
  // A user whose only handle is a bogus phone is skipped (not pushed).
  if (!isPlausiblePhone(user.phone) && !user.email) {
    return { status: 'skipped', error: 'no usable phone or email' };
  }

  const body = buildContactBody(user, locationId);
  if (opts.extraTags && opts.extraTags.length > 0) {
    body.tags = [...new Set([...(body.tags as string[]), ...opts.extraTags])];
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? SYNC_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${baseUrl()}/contacts/upsert`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: API_VERSION,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { status: 'failed', error: `ghl ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json().catch(() => ({}))) as {
      contact?: { id?: string };
      id?: string;
    };
    const contactId = json.contact?.id ?? json.id;
    return { status: 'synced', contactId };
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Upsert the user into HighLevel and persist the returned contact id +
 * sync timestamp onto the `user` row. Safe to call fire-and-forget:
 *
 *     void syncUserToHighLevel(ctx.storage, user, { now, log: ctx.log });
 *
 * It never throws. The writeback touches only the `highlevel_*` columns,
 * so it can never re-trigger a profile-change sync (no loop).
 */
export async function syncUserToHighLevel(
  storage: Storage,
  user: UserRecord,
  opts: { now: number; log?: SyncLogger; fetchImpl?: typeof fetch; extraTags?: readonly string[] },
): Promise<SyncResult> {
  let result: SyncResult;
  try {
    result = await upsertContact(user, { fetchImpl: opts.fetchImpl, extraTags: opts.extraTags });
  } catch (err) {
    // upsertContact already swallows its own errors, but stay defensive.
    result = { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }

  try {
    if (result.status === 'synced' && result.contactId) {
      storage.updateUser(
        user.id,
        { highlevel_contact_id: result.contactId, highlevel_synced_at: opts.now },
        opts.now,
      );
      opts.log?.info(
        { userId: user.id, contactId: result.contactId },
        'highlevel: contact synced',
      );
    } else if (result.status === 'failed') {
      opts.log?.warn({ userId: user.id, error: result.error }, 'highlevel: sync failed');
    }
  } catch (err) {
    opts.log?.warn(
      { userId: user.id, err: err instanceof Error ? err.message : String(err) },
      'highlevel: contact-id writeback failed',
    );
  }

  return result;
}
