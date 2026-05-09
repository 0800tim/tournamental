/**
 * SQLite storage for OTP records, users, and sessions.
 *
 * better-sqlite3 is synchronous and *fast* — perfect for a
 * single-instance auth service. Schema lives inline so a fresh boot
 * works without external migration tooling. If we ever shard out to
 * Postgres we'll move this to Prisma per CLAUDE.md.
 *
 * PII handling:
 *   - Phone numbers are stored E.164-normalised (with leading +).
 *   - We deliberately do not log raw phone numbers; the operator log
 *     only sees a SHA-256-truncated phone hash for correlation.
 *   - At-rest encryption (sqlcipher) is opt-in via AUTH_SQLITE_KEY
 *     when the binary is built against sqlcipher. Without it the file
 *     is plain SQLite — see docs/32-auth-and-privacy.md for the
 *     deployment-time encryption posture.
 */

import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface OtpRecord {
  phone: string;
  otp_hash: string;
  channel: 'sms' | 'whatsapp';
  attempts: number;
  expires_at: number; // unix seconds
  created_at: number; // unix seconds
}

export interface UserRecord {
  id: string;
  phone: string;
  display_name: string | null;
  country: string | null;
  created_at: number;
  last_seen_at: number;
}

export interface SessionRecord {
  id: string;
  user_id: string;
  jwt_jti: string;
  created_at: number;
  expires_at: number;
  user_agent: string | null;
  ip: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS phone_otp (
  phone TEXT PRIMARY KEY,
  otp_hash TEXT NOT NULL,
  channel TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  display_name TEXT,
  country TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_phone ON user(phone);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id),
  jwt_jti TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_session_user_id ON session(user_id);
CREATE INDEX IF NOT EXISTS idx_session_expires ON session(expires_at);

CREATE TABLE IF NOT EXISTS rate_limit (
  -- key is e.g. "phone:+6421...:request" or "ip:1.2.3.4:request".
  key TEXT NOT NULL,
  bucket_start INTEGER NOT NULL,  -- unix seconds, start of the rolling window
  count INTEGER NOT NULL,
  PRIMARY KEY (key, bucket_start)
);
CREATE INDEX IF NOT EXISTS idx_rl_key ON rate_limit(key);
`;

export interface StorageOptions {
  /** Filesystem path to the SQLite db. Use ":memory:" for tests. */
  path: string;
  /** Optional: enable WAL mode (default true for file DBs). */
  wal?: boolean;
}

export class Storage {
  readonly db: Database.Database;

  constructor(opts: StorageOptions) {
    if (opts.path !== ':memory:') {
      mkdirSync(dirname(opts.path), { recursive: true });
    }
    this.db = new Database(opts.path);
    if (opts.path !== ':memory:' && opts.wal !== false) {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ---- OTP records ----

  upsertOtp(rec: OtpRecord): void {
    this.db
      .prepare(
        `INSERT INTO phone_otp (phone, otp_hash, channel, attempts, expires_at, created_at)
         VALUES (@phone, @otp_hash, @channel, @attempts, @expires_at, @created_at)
         ON CONFLICT(phone) DO UPDATE SET
           otp_hash = excluded.otp_hash,
           channel = excluded.channel,
           attempts = excluded.attempts,
           expires_at = excluded.expires_at,
           created_at = excluded.created_at`,
      )
      .run(rec);
  }

  getOtp(phone: string): OtpRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM phone_otp WHERE phone = ?`)
      .get(phone) as OtpRecord | undefined;
    return row ?? null;
  }

  incrementOtpAttempts(phone: string): number {
    const row = this.db
      .prepare(
        `UPDATE phone_otp SET attempts = attempts + 1
         WHERE phone = ?
         RETURNING attempts`,
      )
      .get(phone) as { attempts: number } | undefined;
    return row?.attempts ?? 0;
  }

  deleteOtp(phone: string): void {
    this.db.prepare(`DELETE FROM phone_otp WHERE phone = ?`).run(phone);
  }

  /** Remove all expired OTP rows. Call periodically (e.g. on each request). */
  pruneExpiredOtps(now: number): number {
    const r = this.db
      .prepare(`DELETE FROM phone_otp WHERE expires_at < ?`)
      .run(now);
    return r.changes ?? 0;
  }

  // ---- Users ----

  /** Find by phone, or create a new user. Returns the user. */
  findOrCreateUser(phone: string, now: number): UserRecord {
    const existing = this.db
      .prepare(`SELECT * FROM user WHERE phone = ?`)
      .get(phone) as UserRecord | undefined;
    if (existing) {
      this.db
        .prepare(`UPDATE user SET last_seen_at = ? WHERE id = ?`)
        .run(now, existing.id);
      return { ...existing, last_seen_at: now };
    }
    const id = `u_${randomUUID().replace(/-/g, '').slice(0, 22)}`;
    const rec: UserRecord = {
      id,
      phone,
      display_name: null,
      country: null,
      created_at: now,
      last_seen_at: now,
    };
    this.db
      .prepare(
        `INSERT INTO user (id, phone, display_name, country, created_at, last_seen_at)
         VALUES (@id, @phone, @display_name, @country, @created_at, @last_seen_at)`,
      )
      .run(rec);
    return rec;
  }

  getUser(id: string): UserRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM user WHERE id = ?`)
      .get(id) as UserRecord | undefined;
    return row ?? null;
  }

  // ---- Sessions ----

  insertSession(rec: SessionRecord): void {
    this.db
      .prepare(
        `INSERT INTO session (id, user_id, jwt_jti, created_at, expires_at, user_agent, ip)
         VALUES (@id, @user_id, @jwt_jti, @created_at, @expires_at, @user_agent, @ip)`,
      )
      .run(rec);
  }

  getSessionByJti(jti: string): SessionRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM session WHERE jwt_jti = ?`)
      .get(jti) as SessionRecord | undefined;
    return row ?? null;
  }

  revokeSessionByJti(jti: string): void {
    this.db.prepare(`DELETE FROM session WHERE jwt_jti = ?`).run(jti);
  }

  // ---- Rate limit storage (token bucket fixed-window) ----

  /**
   * Increments the counter for (key, bucket_start) and returns the new count.
   * Old buckets are pruned opportunistically.
   */
  bumpRateBucket(key: string, bucketStart: number): number {
    const tx = this.db.transaction((k: string, b: number) => {
      this.db
        .prepare(
          `INSERT INTO rate_limit (key, bucket_start, count)
           VALUES (?, ?, 1)
           ON CONFLICT(key, bucket_start) DO UPDATE SET count = count + 1`,
        )
        .run(k, b);
      return (
        this.db
          .prepare(
            `SELECT count FROM rate_limit WHERE key = ? AND bucket_start = ?`,
          )
          .get(k, b) as { count: number }
      ).count;
    });
    return tx(key, bucketStart);
  }

  getRateBucket(key: string, bucketStart: number): number {
    const row = this.db
      .prepare(`SELECT count FROM rate_limit WHERE key = ? AND bucket_start = ?`)
      .get(key, bucketStart) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  pruneRateBuckets(olderThan: number): number {
    return (
      this.db
        .prepare(`DELETE FROM rate_limit WHERE bucket_start < ?`)
        .run(olderThan).changes ?? 0
    );
  }
}

/** Truncated SHA-256 of a phone for safe logging / correlation IDs. */
export function phoneLogId(phone: string): string {
  return createHash('sha256').update(phone).digest('hex').slice(0, 12);
}
