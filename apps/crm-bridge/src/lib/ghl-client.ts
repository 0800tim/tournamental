/**
 * GoHighLevel client.
 *
 * Two backends share one interface:
 *
 *   - {@link MockGhlClient}  — never touches the network; appends every
 *     logical operation as a JSON line to `data/ghl-calls.jsonl` so we
 *     have a deterministic audit trail in dev + tests.
 *   - {@link RealGhlClient}  — POSTs/PUTs to the real GHL v2 REST API at
 *     `https://services.leadconnectorhq.com/`.
 *
 * Selection is controlled at the server boot layer via the `CRM_BACKEND`
 * env var. Defaults to `mock` so a misconfigured deploy never silently
 * spams a customer's CRM.
 *
 * GHL contact identity: VTourn's `userId` is the durable key. We surface
 * it as the `vtourn_user_id` custom field. The mock echoes the userId back
 * as the contactId; the real client uses GHL's `/contacts/upsert` response
 * which is keyed off email/phone (the upsert is GHL's contract for
 * "create-or-merge by identity") and returns a `contact.id` we then use
 * for tag and custom-field calls.
 *
 * Idempotency on the GHL side: every upsert carries the originating
 * `eventId` as the `vtourn_last_event_id` custom field. Duplicate events
 * are blocked at the EventStore layer; this is just a forensic breadcrumb
 * if a duplicate ever does slip through.
 */

import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Custom-field keys synced into GHL per docs/25. */
export type GhlCustomFieldKey =
  | 'vtourn_user_id'
  | 'vtourn_last_event_id'
  | 'humanness_score'
  | 'total_predictions'
  | 'current_rank'
  | 'syndicates'
  | 'last_pick_at'
  | 'last_lock_in_odds_avg'
  | 'device_country';

export type GhlCustomFields = Partial<Record<GhlCustomFieldKey, string | number>>;

export interface GhlContactUpsert {
  /** VTourn user id; surfaced as the vtourn_user_id custom field. */
  userId: string;
  email?: string;
  phone?: string;
  /** ISO alpha-2, e.g. "NZ", "US". */
  country?: string;
  /** Acquisition source (e.g. "telegram", "web", "twitter-ad"). */
  source?: string;
  customFields?: GhlCustomFields;
  /** Tags to add. Existing tags are preserved by GHL semantics. */
  addTags?: readonly string[];
  /** Tags to remove. Useful for engagement-band churn. */
  removeTags?: readonly string[];
  /** Optional originating eventId; recorded as vtourn_last_event_id. */
  eventId?: string;
}

/** Result returned by every {@link GhlClient} write. */
export interface GhlWriteResult {
  ok: boolean;
  /** GHL contact id when the call succeeded. */
  externalId?: string;
  /** Raw response body or recorded payload (mock). */
  raw: unknown;
}

/** Slim view of a GHL contact returned by {@link GhlClient.getContact}. */
export interface GhlContactView {
  id: string;
  email?: string;
  phone?: string;
  tags: string[];
  customFields: GhlCustomFields;
  raw: unknown;
}

/** A single recorded call to the (mocked) GHL API. */
export interface GhlCallRecord {
  ts: number; // unix seconds
  op: 'upsert_contact' | 'add_tags' | 'remove_tags' | 'set_custom_fields';
  userId: string;
  payload: Record<string, unknown>;
}

export interface GhlClient {
  upsertContact(input: GhlContactUpsert): Promise<{ contactId: string } & Partial<GhlWriteResult>>;
  addTag(contactId: string, tags: readonly string[]): Promise<GhlWriteResult>;
  removeTag(contactId: string, tags: readonly string[]): Promise<GhlWriteResult>;
  setCustomField(contactId: string, fields: GhlCustomFields): Promise<GhlWriteResult>;
  getContact(contactId: string): Promise<GhlContactView | null>;
  /** Snapshot of every recorded call — only meaningful for the mock. */
  recordedCalls(): readonly GhlCallRecord[];
}

// ---------------------------------------------------------------------------
// Mock client
// ---------------------------------------------------------------------------

export interface MockGhlClientOptions {
  /** Where to append JSONL records. Pass null to skip filesystem writes. */
  jsonlPath: string | null;
  /** Injected clock (unix seconds). Defaults to wall clock. */
  now?: () => number;
}

/**
 * Mock GHL client. Records every logical operation in memory + appends
 * one JSONL line per record. The split mirrors how the real GHL API
 * expects three separate calls (upsert + tags + custom fields) so
 * downstream readers (e.g. the customer-360 aggregate) can replay the log
 * without needing a Postgres table.
 */
export class MockGhlClient implements GhlClient {
  private readonly calls: GhlCallRecord[] = [];
  private readonly jsonlPath: string | null;
  private readonly now: () => number;

  constructor(opts: MockGhlClientOptions) {
    this.jsonlPath = opts.jsonlPath;
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
    if (this.jsonlPath) {
      mkdirSync(dirname(this.jsonlPath), { recursive: true });
    }
  }

  async upsertContact(
    input: GhlContactUpsert,
  ): Promise<{ contactId: string } & Partial<GhlWriteResult>> {
    // 1. The contact upsert itself.
    const cf: GhlCustomFields = { ...(input.customFields ?? {}) };
    if (input.eventId) cf.vtourn_last_event_id = input.eventId;

    this.record({
      op: 'upsert_contact',
      userId: input.userId,
      payload: {
        email: input.email,
        phone: input.phone,
        country: input.country,
        source: input.source,
      },
    });

    // 2. Custom fields, if any.
    if (Object.keys(cf).length > 0) {
      this.record({
        op: 'set_custom_fields',
        userId: input.userId,
        payload: { customFields: cf },
      });
    }

    // 3. Tag adds, if any.
    if (input.addTags && input.addTags.length > 0) {
      this.record({
        op: 'add_tags',
        userId: input.userId,
        payload: { tags: [...input.addTags] },
      });
    }

    // 4. Tag removes, if any.
    if (input.removeTags && input.removeTags.length > 0) {
      this.record({
        op: 'remove_tags',
        userId: input.userId,
        payload: { tags: [...input.removeTags] },
      });
    }

    return { contactId: input.userId, ok: true, externalId: input.userId, raw: input };
  }

  async addTag(contactId: string, tags: readonly string[]): Promise<GhlWriteResult> {
    this.record({
      op: 'add_tags',
      userId: contactId,
      payload: { tags: [...tags] },
    });
    return { ok: true, externalId: contactId, raw: { tags: [...tags] } };
  }

  async removeTag(contactId: string, tags: readonly string[]): Promise<GhlWriteResult> {
    this.record({
      op: 'remove_tags',
      userId: contactId,
      payload: { tags: [...tags] },
    });
    return { ok: true, externalId: contactId, raw: { tags: [...tags] } };
  }

  async setCustomField(
    contactId: string,
    fields: GhlCustomFields,
  ): Promise<GhlWriteResult> {
    this.record({
      op: 'set_custom_fields',
      userId: contactId,
      payload: { customFields: fields },
    });
    return { ok: true, externalId: contactId, raw: { customFields: fields } };
  }

  async getContact(contactId: string): Promise<GhlContactView | null> {
    // Replay the recorded calls for this id into a synthetic view. Tests
    // that want a richer view should use the customer-360 aggregate.
    const calls = this.calls.filter((c) => c.userId === contactId);
    if (calls.length === 0) return null;
    const tags = new Set<string>();
    const customFields: GhlCustomFields = {};
    let email: string | undefined;
    let phone: string | undefined;
    for (const c of calls) {
      if (c.op === 'upsert_contact') {
        const p = c.payload as { email?: string; phone?: string };
        if (p.email) email = p.email;
        if (p.phone) phone = p.phone;
      } else if (c.op === 'add_tags') {
        for (const t of (c.payload.tags as string[]) ?? []) tags.add(t);
      } else if (c.op === 'remove_tags') {
        for (const t of (c.payload.tags as string[]) ?? []) tags.delete(t);
      } else if (c.op === 'set_custom_fields') {
        Object.assign(customFields, c.payload.customFields as GhlCustomFields);
      }
    }
    return {
      id: contactId,
      email,
      phone,
      tags: [...tags],
      customFields,
      raw: { calls },
    };
  }

  recordedCalls(): readonly GhlCallRecord[] {
    return this.calls;
  }

  private record(rec: Omit<GhlCallRecord, 'ts'>): void {
    const full: GhlCallRecord = { ts: this.now(), ...rec };
    this.calls.push(full);
    if (this.jsonlPath) {
      appendFileSync(this.jsonlPath, `${JSON.stringify(full)}\n`, 'utf8');
    }
  }
}

// ---------------------------------------------------------------------------
// Real client
// ---------------------------------------------------------------------------

export interface RealGhlClientOptions {
  apiKey: string;
  locationId: string;
  /** Override the API base URL (tests). Defaults to LeadConnector v2. */
  baseUrl?: string;
  /** Override the API version header. Defaults to GHL's pinned 2021-07-28. */
  apiVersion?: string;
  /** Where to append failed-call records. Pass null to disable. */
  failedLogPath: string | null;
  /** Injected fetch (tests). Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Sleeper used by the retry loop (tests). Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Max retry attempts for 429/5xx. Default 3. */
  maxRetries?: number;
  /** Injected clock (unix seconds). Defaults to wall clock. */
  now?: () => number;
}

const DEFAULT_BASE_URL = 'https://services.leadconnectorhq.com';
const DEFAULT_API_VERSION = '2021-07-28';

/** Shape we append to `data/ghl-failed.jsonl` for replay. */
export interface GhlFailedCallRecord {
  ts: number;
  op:
    | 'upsert_contact'
    | 'add_tags'
    | 'remove_tags'
    | 'set_custom_fields'
    | 'get_contact';
  /** Best-effort GHL contact id, where known. */
  contactId?: string;
  /** Originating VTourn user id, where known. */
  userId?: string;
  /** Original payload so the operation can be replayed verbatim. */
  payload: Record<string, unknown>;
  /** Last error surface (HTTP status + body or thrown message). */
  error: { status?: number; message: string };
}

/**
 * Real GHL client — talks to `services.leadconnectorhq.com` over HTTP.
 *
 * Behaviour notes:
 * - `upsertContact` calls `POST /contacts/upsert`, which is the v2 contract
 *   for "create-or-merge by email/phone". Tags and custom fields can be
 *   passed in the same body, so we do — one network round-trip when the
 *   caller hasn't asked for tag removal. If `removeTags` is set, we make
 *   the upsert first then issue a `DELETE /contacts/{id}/tags`.
 * - All writes go through {@link request} which retries 429 / 5xx up to
 *   3 times with 1s / 2s / 4s back-off. On final failure we append a
 *   structured record to the failed-log so it can be replayed by
 *   `POST /v1/admin/replay-failed`.
 * - `recordedCalls()` returns an empty array — the real client doesn't
 *   keep an in-memory audit trail.
 */
export class RealGhlClient implements GhlClient {
  private readonly apiKey: string;
  private readonly locationId: string;
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly failedLogPath: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly now: () => number;

  constructor(opts: RealGhlClientOptions) {
    if (!opts.apiKey) throw new Error('RealGhlClient: apiKey is required');
    if (!opts.locationId) throw new Error('RealGhlClient: locationId is required');
    this.apiKey = opts.apiKey;
    this.locationId = opts.locationId;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.apiVersion = opts.apiVersion ?? DEFAULT_API_VERSION;
    this.failedLogPath = opts.failedLogPath;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.sleep =
      opts.sleep ??
      ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = opts.maxRetries ?? 3;
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
    if (this.failedLogPath) {
      mkdirSync(dirname(this.failedLogPath), { recursive: true });
    }
  }

  async upsertContact(
    input: GhlContactUpsert,
  ): Promise<{ contactId: string } & GhlWriteResult> {
    const customFields = customFieldsToArray({
      ...(input.customFields ?? {}),
      ...(input.eventId ? { vtourn_last_event_id: input.eventId } : {}),
    });
    const body: Record<string, unknown> = {
      locationId: this.locationId,
      source: input.source ?? 'vtourn-crm-bridge',
    };
    if (input.email) body.email = input.email;
    if (input.phone) body.phone = input.phone;
    if (input.country) body.country = input.country;
    if (customFields.length > 0) body.customFields = customFields;
    if (input.addTags && input.addTags.length > 0) body.tags = [...input.addTags];

    const upsertResult = await this.request({
      op: 'upsert_contact',
      method: 'POST',
      path: '/contacts/upsert',
      body,
      userId: input.userId,
    });

    if (!upsertResult.ok) {
      return { contactId: '', ok: false, raw: upsertResult.raw };
    }

    const contactId = extractContactId(upsertResult.raw) ?? '';

    // GHL's upsert payload doesn't accept a "tags to remove" field, so
    // we issue a follow-up DELETE only when the caller requested removal.
    if (contactId && input.removeTags && input.removeTags.length > 0) {
      await this.removeTag(contactId, input.removeTags);
    }

    return {
      contactId,
      ok: true,
      externalId: contactId,
      raw: upsertResult.raw,
    };
  }

  async addTag(contactId: string, tags: readonly string[]): Promise<GhlWriteResult> {
    if (!contactId) {
      return { ok: false, raw: { error: 'missing contactId' } };
    }
    const result = await this.request({
      op: 'add_tags',
      method: 'POST',
      path: `/contacts/${encodeURIComponent(contactId)}/tags`,
      body: { tags: [...tags] },
      contactId,
    });
    return {
      ok: result.ok,
      externalId: result.ok ? contactId : undefined,
      raw: result.raw,
    };
  }

  async removeTag(contactId: string, tags: readonly string[]): Promise<GhlWriteResult> {
    if (!contactId) {
      return { ok: false, raw: { error: 'missing contactId' } };
    }
    const result = await this.request({
      op: 'remove_tags',
      method: 'DELETE',
      path: `/contacts/${encodeURIComponent(contactId)}/tags`,
      body: { tags: [...tags] },
      contactId,
    });
    return {
      ok: result.ok,
      externalId: result.ok ? contactId : undefined,
      raw: result.raw,
    };
  }

  async setCustomField(
    contactId: string,
    fields: GhlCustomFields,
  ): Promise<GhlWriteResult> {
    if (!contactId) {
      return { ok: false, raw: { error: 'missing contactId' } };
    }
    const result = await this.request({
      op: 'set_custom_fields',
      method: 'PUT',
      path: `/contacts/${encodeURIComponent(contactId)}`,
      body: { customFields: customFieldsToArray(fields) },
      contactId,
    });
    return {
      ok: result.ok,
      externalId: result.ok ? contactId : undefined,
      raw: result.raw,
    };
  }

  async getContact(contactId: string): Promise<GhlContactView | null> {
    if (!contactId) return null;
    const result = await this.request({
      op: 'get_contact',
      method: 'GET',
      path: `/contacts/${encodeURIComponent(contactId)}`,
      contactId,
    });
    if (!result.ok) return null;
    const raw = result.raw as { contact?: Record<string, unknown> };
    const c = raw.contact ?? (result.raw as Record<string, unknown>);
    if (!c || typeof c !== 'object') return null;
    return parseContactView(contactId, c as Record<string, unknown>, result.raw);
  }

  recordedCalls(): readonly GhlCallRecord[] {
    return [];
  }

  // -------------------------------------------------------------------------
  // HTTP plumbing
  // -------------------------------------------------------------------------

  /**
   * Make an authenticated request with retry/back-off. Network errors,
   * 429s, and 5xx responses are retried up to {@link maxRetries} times
   * with exponentially increasing delays (1s, 2s, 4s, …). On final
   * failure, append a structured record to the failed-call log so it can
   * be replayed.
   */
  private async request(args: {
    op: GhlFailedCallRecord['op'];
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    body?: Record<string, unknown>;
    contactId?: string;
    userId?: string;
  }): Promise<{ ok: boolean; status: number; raw: unknown }> {
    const url = `${this.baseUrl}${args.path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Version: this.apiVersion,
      Accept: 'application/json',
      LocationId: this.locationId,
    };
    const init: RequestInit = {
      method: args.method,
      headers,
    };
    if (args.body !== undefined && args.method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(args.body);
    }

    let lastStatus = 0;
    let lastRaw: unknown = null;
    let lastError: string = 'no_response';

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const res = await this.fetchImpl(url, init);
        lastStatus = res.status;
        const raw = await safeJson(res);
        lastRaw = raw;
        if (res.ok) {
          return { ok: true, status: res.status, raw };
        }
        // Non-OK: decide retryable.
        if (!isRetryable(res.status) || attempt === this.maxRetries) {
          lastError = `http_${res.status}`;
          break;
        }
        await this.sleep(backoffMs(attempt));
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        lastRaw = { error: lastError };
        if (attempt === this.maxRetries) break;
        await this.sleep(backoffMs(attempt));
      }
    }

    this.recordFailure({
      ts: this.now(),
      op: args.op,
      contactId: args.contactId,
      userId: args.userId,
      payload: {
        method: args.method,
        path: args.path,
        body: args.body ?? null,
      },
      error: { status: lastStatus || undefined, message: lastError },
    });

    return { ok: false, status: lastStatus, raw: lastRaw };
  }

  private recordFailure(rec: GhlFailedCallRecord): void {
    if (!this.failedLogPath) return;
    appendFileSync(this.failedLogPath, `${JSON.stringify(rec)}\n`, 'utf8');
  }

  /**
   * Replay one previously-failed call. Used by the
   * `/v1/admin/replay-failed` endpoint. Returns whether the replay
   * succeeded — the caller decides whether to keep or drop the entry
   * from the failed-log.
   */
  async replayFailed(rec: GhlFailedCallRecord): Promise<{ ok: boolean; raw: unknown }> {
    const payload = rec.payload as {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      path?: string;
      body?: Record<string, unknown> | null;
    };
    if (!payload.method || !payload.path) {
      return { ok: false, raw: { error: 'malformed_record' } };
    }
    return this.request({
      op: rec.op,
      method: payload.method,
      path: payload.path,
      body: payload.body ?? undefined,
      contactId: rec.contactId,
      userId: rec.userId,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function backoffMs(attempt: number): number {
  // 0 → 1000, 1 → 2000, 2 → 4000, …
  return 1000 * 2 ** attempt;
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

/**
 * GHL's v2 API expects custom fields as an array of `{ key, field_value }`
 * (or `{ id, field_value }`). We send `key` since that's what Tim's
 * location is configured with — the keys map 1:1 to {@link GhlCustomFieldKey}.
 */
function customFieldsToArray(
  fields: GhlCustomFields,
): Array<{ key: string; field_value: string | number }> {
  const out: Array<{ key: string; field_value: string | number }> = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    out.push({ key, field_value: value });
  }
  return out;
}

function extractContactId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const direct = r.contact;
  if (direct && typeof direct === 'object') {
    const id = (direct as Record<string, unknown>).id;
    if (typeof id === 'string' && id) return id;
  }
  if (typeof r.id === 'string' && r.id) return r.id;
  if (typeof r.contactId === 'string' && r.contactId) return r.contactId;
  return undefined;
}

function parseContactView(
  fallbackId: string,
  c: Record<string, unknown>,
  raw: unknown,
): GhlContactView {
  const id = typeof c.id === 'string' && c.id ? c.id : fallbackId;
  const email = typeof c.email === 'string' ? c.email : undefined;
  const phone = typeof c.phone === 'string' ? c.phone : undefined;
  const tags = Array.isArray(c.tags)
    ? (c.tags.filter((t) => typeof t === 'string') as string[])
    : [];
  const customFields: GhlCustomFields = {};
  const cfs = c.customFields;
  if (Array.isArray(cfs)) {
    for (const entry of cfs) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const key = typeof e.key === 'string' ? e.key : undefined;
      const value = e.field_value ?? e.value;
      if (key && (typeof value === 'string' || typeof value === 'number')) {
        (customFields as Record<string, string | number>)[key] = value;
      }
    }
  } else if (cfs && typeof cfs === 'object') {
    for (const [k, v] of Object.entries(cfs as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number') {
        (customFields as Record<string, string | number>)[k] = v;
      }
    }
  }
  return { id, email, phone, tags, customFields, raw };
}
