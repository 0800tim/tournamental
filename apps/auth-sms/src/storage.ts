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
  /**
   * 32-byte hex magic-link token bound to the OTP row, or NULL when
   * the OTP was issued via the legacy outbound flow (POST /v1/auth/request).
   * Set by the inbound-login flow so the user can tap a one-tap
   * sign-in link as well as paste the 6-digit code.
   */
  challenge: string | null;
  /**
   * IP that first used this code (magic-link click OR code paste).
   * Subsequent attempts to use the same code from a different IP are
   * rejected. NULL until first use. We bind on FIRST USE rather than
   * at issuance because the user requests the code via phone but
   * usually verifies on a different device (their desktop).
   */
  bound_ip: string | null;
  /**
   * Short SHA-256 hash of (user-agent || accept-language) recorded on
   * first use; second axis of binding alongside bound_ip. NULL until
   * first use.
   */
  bound_ua_fp: string | null;
  /**
   * Counter for failed magic-token / code-paste attempts BEFORE the
   * row is consumed. Distinct from `attempts` which tracks the legacy
   * outbound-flow verify failures (per-phone). This is the
   * primary brute-force defence and is per-code (not per-IP).
   */
  magic_attempts: number;
}

export interface UserRecord {
  id: string;
  /**
   * E.164 phone, or `null` for users who signed up via a non-phone provider
   * (e.g. Telegram Login Widget, email). The runtime invariant is "at least
   * one external identity is set" — phone OR telegram_id OR email.
   */
  phone: string | null;
  display_name: string | null;
  country: string | null;
  /** Numeric Telegram user id, set if the user linked Telegram. */
  telegram_id: number | null;
  /** Telegram @-handle without the leading @, if the user has one set. */
  telegram_username: string | null;
  created_at: number;
  last_seen_at: number;
  /** Profile fields editable from /profile. NULL until set. */
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  city: string | null;
  favourite_team_code: string | null;
  /** Returned HighLevel contact ID once we've synced this user. NULL if not yet. */
  highlevel_contact_id: string | null;
  /** Unix seconds when the contact was last synced to HighLevel. NULL if not yet. */
  highlevel_synced_at: number | null;
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
  created_at INTEGER NOT NULL,
  -- Inbound-login extensions (added v0.3). NULL on rows created by
  -- the legacy outbound /v1/auth/request flow.
  challenge TEXT,
  bound_ip TEXT,
  bound_ua_fp TEXT,
  magic_attempts INTEGER NOT NULL DEFAULT 0
);
-- Lookup by magic token for /v1/auth/magic-verify and /v1/auth/verify-by-code.
CREATE UNIQUE INDEX IF NOT EXISTS idx_phone_otp_challenge ON phone_otp(challenge)
  WHERE challenge IS NOT NULL;

CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  phone TEXT,
  display_name TEXT,
  country TEXT,
  telegram_id INTEGER,
  telegram_username TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  -- Profile fields added v0.4. NULL until the user fills them in.
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  city TEXT,
  favourite_team_code TEXT,
  highlevel_contact_id TEXT,
  highlevel_synced_at INTEGER
);
-- idx_user_email_unique is created in migrateUserProfileColumns()
-- after the ADD COLUMN runs on legacy DBs.
-- SQLite treats multiple NULLs as distinct in a UNIQUE index, so phone
-- can be NULL for Telegram-only users while still being unique when set.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_phone_unique ON user(phone)
  WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_telegram_id_unique ON user(telegram_id)
  WHERE telegram_id IS NOT NULL;

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

-- Email OTP table (mirrors phone_otp). Email is the primary key,
-- lowercased + trimmed by the caller before insert. otp_hash is HMAC
-- bound to (code, email, channel='email', secret) so the same code
-- can never validate against a different email row.
CREATE TABLE IF NOT EXISTS email_otp (
  email TEXT PRIMARY KEY,
  otp_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
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
    this.migrateUserTableIfNeeded();
    this.migrateUserProfileColumns();
    this.migratePhoneOtpTableIfNeeded();
  }

  /**
   * v0.3 → v0.4: add profile editor fields + HighLevel sync columns to
   * `user`. SQLite ADD COLUMN is non-destructive; legacy rows simply
   * carry NULL until the user edits them.
   */
  private migrateUserProfileColumns(): void {
    const cols = this.db
      .prepare(`PRAGMA table_info(user)`)
      .all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    const want: Array<[string, string]> = [
      ['email', 'TEXT'],
      ['first_name', 'TEXT'],
      ['last_name', 'TEXT'],
      ['city', 'TEXT'],
      ['favourite_team_code', 'TEXT'],
      ['highlevel_contact_id', 'TEXT'],
      ['highlevel_synced_at', 'INTEGER'],
    ];
    for (const [col, type] of want) {
      if (!names.has(col)) {
        this.db.exec(`ALTER TABLE user ADD COLUMN ${col} ${type}`);
      }
    }
    this.db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email_unique ON user(email)
         WHERE email IS NOT NULL`,
    );
  }

  /**
   * v0.2 → v0.3: add `challenge`, `bound_ip`, `bound_ua_fp`,
   * `magic_attempts` columns to `phone_otp` to support the inbound-login
   * magic-link + code-paste flow. SQLite ADD COLUMN is non-destructive.
   */
  private migratePhoneOtpTableIfNeeded(): void {
    const cols = this.db
      .prepare(`PRAGMA table_info(phone_otp)`)
      .all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    if (!names.has('challenge')) {
      this.db.exec(`ALTER TABLE phone_otp ADD COLUMN challenge TEXT`);
    }
    if (!names.has('bound_ip')) {
      this.db.exec(`ALTER TABLE phone_otp ADD COLUMN bound_ip TEXT`);
    }
    if (!names.has('bound_ua_fp')) {
      this.db.exec(`ALTER TABLE phone_otp ADD COLUMN bound_ua_fp TEXT`);
    }
    if (!names.has('magic_attempts')) {
      this.db.exec(
        `ALTER TABLE phone_otp ADD COLUMN magic_attempts INTEGER NOT NULL DEFAULT 0`,
      );
    }
    this.db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_phone_otp_challenge ON phone_otp(challenge)
         WHERE challenge IS NOT NULL`,
    );
  }

  /**
   * v0.1 → v0.2: the original `user` table had `phone TEXT UNIQUE NOT NULL`
   * and no telegram_* columns. SQLite cannot DROP NOT NULL in place, so if
   * we detect the legacy shape we rebuild the table.
   */
  private migrateUserTableIfNeeded(): void {
    const cols = this.db
      .prepare(`PRAGMA table_info(user)`)
      .all() as Array<{ name: string; notnull: number }>;
    const phoneCol = cols.find((c) => c.name === 'phone');
    const hasTelegramId = cols.some((c) => c.name === 'telegram_id');
    const hasTelegramUsername = cols.some((c) => c.name === 'telegram_username');

    const needsPhoneNullable = phoneCol && phoneCol.notnull === 1;
    const needsTelegramCols = !hasTelegramId || !hasTelegramUsername;

    if (!needsPhoneNullable && !needsTelegramCols) return;

    // Cheap path: just ADD COLUMN for telegram_* if phone is already nullable.
    if (!needsPhoneNullable && needsTelegramCols) {
      if (!hasTelegramId) {
        this.db.exec(`ALTER TABLE user ADD COLUMN telegram_id INTEGER`);
      }
      if (!hasTelegramUsername) {
        this.db.exec(`ALTER TABLE user ADD COLUMN telegram_username TEXT`);
      }
      return;
    }

    // Rebuild path: copy data into a new table with the v0.2 shape.
    this.db.exec(`
      BEGIN;
      CREATE TABLE user_new (
        id TEXT PRIMARY KEY,
        phone TEXT,
        display_name TEXT,
        country TEXT,
        telegram_id INTEGER,
        telegram_username TEXT,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
      INSERT INTO user_new (id, phone, display_name, country, created_at, last_seen_at)
        SELECT id, phone, display_name, country, created_at, last_seen_at FROM user;
      DROP TABLE user;
      ALTER TABLE user_new RENAME TO user;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_phone_unique ON user(phone)
        WHERE phone IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_telegram_id_unique ON user(telegram_id)
        WHERE telegram_id IS NOT NULL;
      COMMIT;
    `);
  }

  close(): void {
    this.db.close();
  }

  // ---- OTP records ----

  upsertOtp(rec: Partial<OtpRecord> & Pick<OtpRecord,
    'phone' | 'otp_hash' | 'channel' | 'attempts' | 'expires_at' | 'created_at'
  >): void {
    this.db
      .prepare(
        `INSERT INTO phone_otp (
           phone, otp_hash, channel, attempts, expires_at, created_at,
           challenge, bound_ip, bound_ua_fp, magic_attempts
         )
         VALUES (
           @phone, @otp_hash, @channel, @attempts, @expires_at, @created_at,
           @challenge, @bound_ip, @bound_ua_fp, @magic_attempts
         )
         ON CONFLICT(phone) DO UPDATE SET
           otp_hash = excluded.otp_hash,
           channel = excluded.channel,
           attempts = excluded.attempts,
           expires_at = excluded.expires_at,
           created_at = excluded.created_at,
           challenge = excluded.challenge,
           bound_ip = excluded.bound_ip,
           bound_ua_fp = excluded.bound_ua_fp,
           magic_attempts = excluded.magic_attempts`,
      )
      .run({
        challenge: null,
        bound_ip: null,
        bound_ua_fp: null,
        magic_attempts: 0,
        ...rec,
      });
  }

  getOtp(phone: string): OtpRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM phone_otp WHERE phone = ?`)
      .get(phone) as OtpRecord | undefined;
    return row ?? null;
  }

  /**
   * Look up an OTP row by its magic-link challenge token. Used by the
   * /v1/auth/magic-verify endpoint when the user taps the one-tap link.
   * Returns null on miss (unknown / expired-and-pruned token).
   */
  getOtpByChallenge(challenge: string): OtpRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM phone_otp WHERE challenge = ?`)
      .get(challenge) as OtpRecord | undefined;
    return row ?? null;
  }

  /**
   * List all currently-active (non-expired) OTP rows that originated
   * from the inbound-login flow (i.e. have a `challenge` set). Used
   * by /v1/auth/verify-by-code to match a bare 6-digit code without a
   * phone number — we recompute each row's hash and constant-time
   * compare. Bounded by the typical active-OTP count (~10s, never
   * more than 1000) so the linear scan is fast.
   */
  listActiveInboundOtps(now: number): readonly OtpRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM phone_otp
           WHERE challenge IS NOT NULL AND expires_at >= ?`,
      )
      .all(now) as OtpRecord[];
  }

  /**
   * Bind an OTP row to the first-use device fingerprint (IP + UA hash).
   * Atomic CAS: only updates if `bound_ip` is still NULL, returns true if
   * the bind succeeded. Subsequent attempts to bind the same row from a
   * different IP/fingerprint observe a non-NULL `bound_ip` and the caller
   * must reject. (We do NOT bind on issuance because the user requests
   * the code from their phone but verifies from their desktop.)
   */
  bindOtpToFingerprint(opts: {
    phone: string;
    ip: string;
    uaFp: string;
  }): { bound: true } | { bound: false; existingIp: string; existingFp: string } {
    const row = this.db
      .prepare(
        `UPDATE phone_otp
           SET bound_ip = ?, bound_ua_fp = ?
           WHERE phone = ? AND bound_ip IS NULL
           RETURNING bound_ip, bound_ua_fp`,
      )
      .get(opts.ip, opts.uaFp, opts.phone) as
      | { bound_ip: string; bound_ua_fp: string }
      | undefined;
    if (row) return { bound: true };
    const existing = this.db
      .prepare(`SELECT bound_ip, bound_ua_fp FROM phone_otp WHERE phone = ?`)
      .get(opts.phone) as
      | { bound_ip: string | null; bound_ua_fp: string | null }
      | undefined;
    return {
      bound: false,
      existingIp: existing?.bound_ip ?? '',
      existingFp: existing?.bound_ua_fp ?? '',
    };
  }

  /**
   * Increment the `magic_attempts` counter and return the new value.
   * Used as the per-code brute-force counter, distinct from `attempts`
   * which is reserved for the legacy outbound-flow lockout logic.
   */
  incrementMagicAttempts(phone: string): number {
    const row = this.db
      .prepare(
        `UPDATE phone_otp SET magic_attempts = magic_attempts + 1
         WHERE phone = ?
         RETURNING magic_attempts`,
      )
      .get(phone) as { magic_attempts: number } | undefined;
    return row?.magic_attempts ?? 0;
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

  // ---- Email OTP ----

  /**
   * Upsert an email OTP row. `email` is the primary key; existing rows
   * for the same email are replaced. Caller passes a lowercased + trimmed
   * email and an HMAC hash bound to (code, email, channel='email', secret).
   */
  upsertEmailOtp(rec: {
    email: string;
    otp_hash: string;
    attempts?: number;
    expires_at: number;
    created_at: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO email_otp (email, otp_hash, attempts, expires_at, created_at)
         VALUES (@email, @otp_hash, @attempts, @expires_at, @created_at)
         ON CONFLICT(email) DO UPDATE SET
           otp_hash = excluded.otp_hash,
           attempts = excluded.attempts,
           expires_at = excluded.expires_at,
           created_at = excluded.created_at`,
      )
      .run({ attempts: 0, ...rec });
  }

  getEmailOtp(email: string): {
    email: string;
    otp_hash: string;
    attempts: number;
    expires_at: number;
    created_at: number;
  } | null {
    const row = this.db
      .prepare(`SELECT * FROM email_otp WHERE email = ?`)
      .get(email) as
      | {
          email: string;
          otp_hash: string;
          attempts: number;
          expires_at: number;
          created_at: number;
        }
      | undefined;
    return row ?? null;
  }

  incrementEmailOtpAttempts(email: string): number {
    const row = this.db
      .prepare(
        `UPDATE email_otp SET attempts = attempts + 1
         WHERE email = ?
         RETURNING attempts`,
      )
      .get(email) as { attempts: number } | undefined;
    return row?.attempts ?? 0;
  }

  deleteEmailOtp(email: string): void {
    this.db.prepare(`DELETE FROM email_otp WHERE email = ?`).run(email);
  }

  pruneExpiredEmailOtps(now: number): number {
    const r = this.db
      .prepare(`DELETE FROM email_otp WHERE expires_at < ?`)
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
      telegram_id: null,
      telegram_username: null,
      created_at: now,
      last_seen_at: now,
      email: null,
      first_name: null,
      last_name: null,
      city: null,
      favourite_team_code: null,
      highlevel_contact_id: null,
      highlevel_synced_at: null,
    };
    this.db
      .prepare(
        `INSERT INTO user (id, phone, display_name, country, telegram_id, telegram_username, created_at, last_seen_at)
         VALUES (@id, @phone, @display_name, @country, @telegram_id, @telegram_username, @created_at, @last_seen_at)`,
      )
      .run(rec);
    return rec;
  }

  /**
   * Find a user by email (case-insensitive) or create a new one. The
   * email is lowercased + trimmed by the caller. Same identity model as
   * findOrCreateUser(phone): one row per verified email, last_seen_at
   * refreshed on every return.
   */
  findOrCreateEmailUser(email: string, now: number): UserRecord {
    const e = email.trim().toLowerCase();
    const existing = this.db
      .prepare(`SELECT * FROM user WHERE email = ?`)
      .get(e) as UserRecord | undefined;
    if (existing) {
      this.db
        .prepare(`UPDATE user SET last_seen_at = ? WHERE id = ?`)
        .run(now, existing.id);
      return { ...existing, last_seen_at: now };
    }
    const id = `u_${randomUUID().replace(/-/g, '').slice(0, 22)}`;
    const rec: UserRecord = {
      id,
      phone: null,
      display_name: null,
      country: null,
      telegram_id: null,
      telegram_username: null,
      created_at: now,
      last_seen_at: now,
      email: e,
      first_name: null,
      last_name: null,
      city: null,
      favourite_team_code: null,
      highlevel_contact_id: null,
      highlevel_synced_at: null,
    };
    this.db
      .prepare(
        `INSERT INTO user (id, email, created_at, last_seen_at)
         VALUES (@id, @email, @created_at, @last_seen_at)`,
      )
      .run(rec);
    return rec;
  }

  /**
   * Find by telegram_id, or create a new user. If `phone` is supplied (e.g.
   * the user shared their phone via the bot's request-contact flow) we set
   * it on a fresh row, or — when it would conflict with an existing
   * phone-only row for the same person — merge by linking the telegram_id
   * onto that existing row.
   */
  findOrCreateTelegramUser(opts: {
    telegramId: number;
    telegramUsername: string | null;
    displayName: string | null;
    phone: string | null;
    now: number;
  }): UserRecord {
    const { telegramId, telegramUsername, displayName, phone, now } = opts;

    // 1. Returning Telegram user.
    const byTelegram = this.db
      .prepare(`SELECT * FROM user WHERE telegram_id = ?`)
      .get(telegramId) as UserRecord | undefined;
    if (byTelegram) {
      // Refresh metadata that may have changed since last login.
      this.db
        .prepare(
          `UPDATE user
             SET telegram_username = COALESCE(?, telegram_username),
                 display_name = COALESCE(display_name, ?),
                 phone = COALESCE(phone, ?),
                 last_seen_at = ?
           WHERE id = ?`,
        )
        .run(telegramUsername, displayName, phone, now, byTelegram.id);
      return this.getUser(byTelegram.id)!;
    }

    // 2. Phone-already-registered user linking Telegram for the first time.
    if (phone) {
      const byPhone = this.db
        .prepare(`SELECT * FROM user WHERE phone = ?`)
        .get(phone) as UserRecord | undefined;
      if (byPhone) {
        this.db
          .prepare(
            `UPDATE user
               SET telegram_id = ?,
                   telegram_username = COALESCE(?, telegram_username),
                   display_name = COALESCE(display_name, ?),
                   last_seen_at = ?
             WHERE id = ?`,
          )
          .run(telegramId, telegramUsername, displayName, now, byPhone.id);
        return this.getUser(byPhone.id)!;
      }
    }

    // 3. Brand-new user.
    const id = `u_${randomUUID().replace(/-/g, '').slice(0, 22)}`;
    const rec: UserRecord = {
      id,
      phone,
      display_name: displayName,
      country: null,
      telegram_id: telegramId,
      telegram_username: telegramUsername,
      created_at: now,
      last_seen_at: now,
      email: null,
      first_name: null,
      last_name: null,
      city: null,
      favourite_team_code: null,
      highlevel_contact_id: null,
      highlevel_synced_at: null,
    };
    this.db
      .prepare(
        `INSERT INTO user (id, phone, display_name, country, telegram_id, telegram_username, created_at, last_seen_at)
         VALUES (@id, @phone, @display_name, @country, @telegram_id, @telegram_username, @created_at, @last_seen_at)`,
      )
      .run(rec);
    return rec;
  }

  /**
   * Patch a user record. Accepts a subset of the editable profile
   * fields; unknown keys are ignored. `last_seen_at` is also bumped
   * because this is the user's most recent action. Returns the
   * updated record, or null if no row matched.
   */
  updateUser(id: string, patch: Partial<Omit<UserRecord, 'id' | 'created_at'>>, now: number): UserRecord | null {
    const allowed: Array<keyof UserRecord> = [
      'display_name',
      'country',
      'email',
      'first_name',
      'last_name',
      'city',
      'favourite_team_code',
      'highlevel_contact_id',
      'highlevel_synced_at',
    ];
    const assignments: string[] = ['last_seen_at = @last_seen_at'];
    const params: Record<string, unknown> = { id, last_seen_at: now };
    for (const key of allowed) {
      if (key in patch) {
        assignments.push(`${key} = @${key}`);
        params[key] = (patch as Record<string, unknown>)[key] ?? null;
      }
    }
    if (assignments.length === 1) {
      // Only the bump; still execute so last_seen updates.
    }
    this.db
      .prepare(`UPDATE user SET ${assignments.join(', ')} WHERE id = @id`)
      .run(params);
    return this.getUser(id);
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
