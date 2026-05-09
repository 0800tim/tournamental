/**
 * Audit-log storage for affiliate clicks.
 *
 * SQLite (better-sqlite3) — synchronous, single-file, plenty fast for the click
 * volume this service handles (capped at 30/min/IP and 3/24h per user/partner).
 *
 * PII handling per docs/30 + docs/32-auth-and-privacy.md:
 *   - Raw user_id is NEVER persisted.
 *   - Only the deterministic SHA-256 hash of (user_id + AFFILIATE_USER_HASH_SALT)
 *     is stored, so we can dedupe and reconcile against partner postbacks
 *     without keeping correlatable identity in the click log.
 *   - IP is NOT stored on the click row; rate limiting uses memory + plugin.
 */

import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ClickRecord {
  id: string;
  partner: string;
  surface: string;
  country: string;
  match_id: string | null;
  team_code: string | null;
  user_id_hash: string | null;
  campaign_id: string | null;
  ts: number; // unix seconds
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clicks (
  id TEXT PRIMARY KEY,
  partner TEXT NOT NULL,
  surface TEXT NOT NULL,
  country TEXT NOT NULL,
  match_id TEXT,
  team_code TEXT,
  user_id_hash TEXT,
  campaign_id TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clicks_partner_ts ON clicks(partner, ts);
CREATE INDEX IF NOT EXISTS idx_clicks_user_partner_ts
  ON clicks(user_id_hash, partner, ts);
CREATE INDEX IF NOT EXISTS idx_clicks_ts ON clicks(ts);
`;

export interface StorageOptions {
  path: string; // ":memory:" for tests, otherwise filesystem path
  wal?: boolean;
}

export class ClickStore {
  readonly db: Database.Database;

  constructor(opts: StorageOptions) {
    if (opts.path !== ':memory:') {
      mkdirSync(dirname(opts.path), { recursive: true });
    }
    this.db = new Database(opts.path);
    if (opts.path !== ':memory:' && opts.wal !== false) {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  insert(rec: Omit<ClickRecord, 'id'> & { id?: string }): ClickRecord {
    const id = rec.id ?? `c_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const row: ClickRecord = {
      id,
      partner: rec.partner,
      surface: rec.surface,
      country: rec.country,
      match_id: rec.match_id ?? null,
      team_code: rec.team_code ?? null,
      user_id_hash: rec.user_id_hash ?? null,
      campaign_id: rec.campaign_id ?? null,
      ts: rec.ts,
    };
    this.db
      .prepare(
        `INSERT INTO clicks
           (id, partner, surface, country, match_id, team_code, user_id_hash, campaign_id, ts)
         VALUES
           (@id, @partner, @surface, @country, @match_id, @team_code, @user_id_hash, @campaign_id, @ts)`,
      )
      .run(row);
    return row;
  }

  /**
   * Count clicks from this user-hash to this partner since `sinceTs` (unix sec).
   * Used for the per-(user, partner) 24h cap.
   */
  countUserPartner(userIdHash: string, partner: string, sinceTs: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM clicks
         WHERE user_id_hash = ? AND partner = ? AND ts >= ?`,
      )
      .get(userIdHash, partner, sinceTs) as { n: number } | undefined;
    return row?.n ?? 0;
  }

  recent(limit: number): ClickRecord[] {
    return this.db
      .prepare(`SELECT * FROM clicks ORDER BY ts DESC LIMIT ?`)
      .all(limit) as ClickRecord[];
  }

  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM clicks`).get() as
      | { n: number }
      | undefined;
    return row?.n ?? 0;
  }
}

/**
 * Deterministic hash for `user_id` so we can dedupe without storing raw IDs.
 *
 * `salt` MUST come from `AFFILIATE_USER_HASH_SALT` in production. The same salt
 * across deploys keeps user_id_hash stable so partner-postback reconciliation
 * works; rotating the salt invalidates dedupe windows on purpose.
 */
export function hashUserId(userId: string, salt: string): string {
  if (!salt || salt.length < 16) {
    throw new Error('hashUserId: salt must be at least 16 chars');
  }
  return createHash('sha256').update(`${userId}|${salt}`).digest('hex');
}
