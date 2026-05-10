/**
 * GoHighLevel client.
 *
 * v0.1: this is a *mock* client. It never reaches the network. Every
 * upsert / tag / custom-field operation is appended as one JSON line to
 * `data/ghl-calls.jsonl` (path injectable for tests). When we wire the
 * real GHL HTTP API the call surface stays the same — only the transport
 * changes — so callers don't have to re-shape their payloads.
 *
 * GHL contact identity: VTourn's `userId` is the durable key. We surface
 * it as the `vtourn_user_id` custom field and *also* use it as the GHL
 * `externalId` so the real client can do `GET /contacts/lookup` instead
 * of an email/phone fuzzy match. Until we go live, the mock simply echoes
 * the userId back as the contact_id.
 */

import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Custom-field keys synced into GHL per docs/25. */
export type GhlCustomFieldKey =
  | 'vtourn_user_id'
  | 'humanness_score'
  | 'total_predictions'
  | 'current_rank'
  | 'syndicates'
  | 'last_pick_at'
  | 'last_lock_in_odds_avg'
  | 'device_country';

export type GhlCustomFields = Partial<Record<GhlCustomFieldKey, string | number>>;

export interface GhlContactUpsert {
  /** VTourn user id; used as the GHL externalId. */
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
}

/** A single recorded call to the (mocked) GHL API. */
export interface GhlCallRecord {
  ts: number; // unix seconds
  op: 'upsert_contact' | 'add_tags' | 'remove_tags' | 'set_custom_fields';
  userId: string;
  payload: Record<string, unknown>;
}

export interface GhlClient {
  upsertContact(input: GhlContactUpsert): Promise<{ contactId: string }>;
  /** Snapshot of every recorded call (for tests + the customer-360 endpoint). */
  recordedCalls(): readonly GhlCallRecord[];
}

export interface MockGhlClientOptions {
  /** Where to append JSONL records. Pass null to skip filesystem writes. */
  jsonlPath: string | null;
  /** Injected clock (unix seconds). Defaults to wall clock. */
  now?: () => number;
}

/**
 * Mock GHL client. Records everything in memory + appends one JSONL line
 * per logical operation so we have an audit trail across restarts.
 *
 * Splitting into multiple records (upsert + add_tags + set_custom_fields)
 * mirrors how the real GHL API expects three separate calls in most flows;
 * downstream readers (e.g. the customer-360 aggregate) can replay the log
 * to rebuild the contact's full state without needing a Postgres table.
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

  async upsertContact(input: GhlContactUpsert): Promise<{ contactId: string }> {
    // 1. The contact upsert itself.
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
    if (input.customFields && Object.keys(input.customFields).length > 0) {
      this.record({
        op: 'set_custom_fields',
        userId: input.userId,
        payload: { customFields: input.customFields },
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

    // The real GHL API returns its own contact_id. The mock uses the userId
    // verbatim so tests + the aggregate endpoint can correlate without a map.
    return { contactId: input.userId };
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
