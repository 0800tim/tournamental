/**
 * Durable store for register-interest signups (RWC 2027 and later).
 *
 * Writes to the shared game.db with better-sqlite3, the same pattern as
 * lib/invite/store.ts. The DDL is idempotent and identical to
 * apps/game/migrations/0017_register_interest.sql so the web app can
 * take signups before the game service restarts.
 *
 * Privacy: PII (email, name, phone) lives only here and in HighLevel.
 * Never log a row; log ids and statuses.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Database, { type Database as DB } from "better-sqlite3";

let _db: DB | null = null;

const DDL = `
CREATE TABLE IF NOT EXISTS register_interest (
  id               TEXT PRIMARY KEY,
  tournament_id    TEXT NOT NULL,
  email            TEXT NOT NULL,
  first_name       TEXT,
  country          TEXT,
  phone            TEXT,
  consent          INTEGER NOT NULL DEFAULT 0,
  source_host      TEXT,
  source_path      TEXT,
  referred_by_code TEXT,
  invite_code      TEXT NOT NULL UNIQUE,
  ip_hash          TEXT,
  user_agent       TEXT,
  ghl_status       TEXT NOT NULL DEFAULT 'queued',
  ghl_contact_id   TEXT,
  ghl_error        TEXT,
  ghl_attempts     INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  UNIQUE (tournament_id, email)
);
CREATE INDEX IF NOT EXISTS idx_register_interest_tournament_created
  ON register_interest(tournament_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_register_interest_referred_by
  ON register_interest(referred_by_code);
CREATE INDEX IF NOT EXISTS idx_register_interest_ghl
  ON register_interest(ghl_status, updated_at);
`;

function resolveDbPath(): string {
  const explicit = process.env.VTORN_GAME_DB_PATH || process.env.GAME_DB_PATH;
  if (explicit && explicit.length > 0) return explicit;
  const root = resolve(process.cwd(), "..", "..");
  return resolve(root, "apps/game/data/game.db");
}

export function registerInterestDb(): DB | null {
  if (_db) return _db;
  const p = resolveDbPath();
  if (!existsSync(p)) {
    // eslint-disable-next-line no-console
    console.warn(`[register-interest/store] game.db not found at ${p}`);
    return null;
  }
  const db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.exec(DDL);
  _db = db;
  return db;
}

export interface RegisterInterestRow {
  id: string;
  tournament_id: string;
  email: string;
  first_name: string | null;
  country: string | null;
  phone: string | null;
  consent: number;
  source_host: string | null;
  source_path: string | null;
  referred_by_code: string | null;
  invite_code: string;
  ghl_status: "queued" | "synced" | "failed" | "skipped";
  ghl_contact_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface RegisterInterestInput {
  tournament_id: string;
  email: string;
  first_name: string | null;
  country: string | null;
  phone: string | null;
  consent: boolean;
  source_host: string | null;
  source_path: string | null;
  referred_by_code: string | null;
  ip: string | null;
  user_agent: string | null;
}

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/l/i

/** Largest multiple of the alphabet size below 256; bytes at or above
 *  it are rejected so every character is equally likely (no modulo
 *  bias). 248 = 8 * 31. */
const CODE_REJECT_FROM = 256 - (256 % CODE_ALPHABET.length);

export function newInviteCode(len = 7): string {
  let out = "";
  while (out.length < len) {
    const bytes = randomBytes(len * 2);
    for (let i = 0; i < bytes.length && out.length < len; i++) {
      const b = bytes[i]!;
      if (b >= CODE_REJECT_FROM) continue;
      out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out;
}

function newId(): string {
  return `ri_${randomBytes(9).toString("hex")}`;
}

let warnedNoSalt = false;

export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const salt = process.env.TOURNAMENTAL_INTERNAL_SECRET;
  if (!salt && !warnedNoSalt) {
    // A constant salt makes the hash reversible by anyone with the
    // code; the hash still beats a raw address, so warn once rather
    // than refuse (review 336-5).
    warnedNoSalt = true;
    // eslint-disable-next-line no-console
    console.warn("[register-interest/store] TOURNAMENTAL_INTERNAL_SECRET is unset; ip_hash uses the default salt");
  }
  return createHash("sha256").update(`${salt ?? "tournamental"}:${ip}`).digest("hex").slice(0, 32);
}

/** Test helper so the one-time warning can be exercised again. */
export function __resetHashIpWarning(): void {
  warnedNoSalt = false;
}

/**
 * Insert or return the existing row for (tournament, email). Idempotent
 * on purpose: a second submit from the same person returns the same
 * invite code rather than an error, so the thank-you state can always
 * show it. Returns `created` so the caller knows whether to push to
 * the CRM again.
 *
 * A repeat submit never changes what is stored, apart from consent,
 * which can only be raised. The form is unauthenticated, so anyone who
 * knows an email address could otherwise overwrite that person's name
 * and phone, or point their attribution at a different invite code
 * (including their own, to inflate a referral count). Attribution is
 * first touch only (review 2026-10-17, RI-02 and RI-03).
 */
export function upsertRegisterInterest(
  input: RegisterInterestInput,
): { row: RegisterInterestRow; created: boolean } | null {
  const db = registerInterestDb();
  if (!db) return null;
  const existing = db
    .prepare(
      `SELECT * FROM register_interest WHERE tournament_id = ? AND email = ?`,
    )
    .get(input.tournament_id, input.email) as RegisterInterestRow | undefined;
  if (existing) {
    db.prepare(
      `UPDATE register_interest
          SET consent = MAX(consent, ?),
              updated_at = ?
        WHERE id = ?`,
    ).run(input.consent ? 1 : 0, Date.now(), existing.id);
    const row = db
      .prepare(`SELECT * FROM register_interest WHERE id = ?`)
      .get(existing.id) as RegisterInterestRow;
    return { row, created: false };
  }

  const now = Date.now();
  const id = newId();
  // Retry on the (astronomically unlikely) invite_code collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newInviteCode();
    try {
      db.prepare(
        `INSERT INTO register_interest
           (id, tournament_id, email, first_name, country, phone, consent,
            source_host, source_path, referred_by_code, invite_code,
            ip_hash, user_agent, ghl_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
      ).run(
        id,
        input.tournament_id,
        input.email,
        input.first_name,
        input.country,
        input.phone,
        input.consent ? 1 : 0,
        input.source_host,
        input.source_path,
        input.referred_by_code,
        code,
        hashIp(input.ip),
        input.user_agent ? input.user_agent.slice(0, 300) : null,
        now,
        now,
      );
      const row = db
        .prepare(`SELECT * FROM register_interest WHERE id = ?`)
        .get(id) as RegisterInterestRow;
      return { row, created: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("UNIQUE") || !msg.includes("invite_code")) throw err;
    }
  }
  throw new Error("register_interest: could not allocate an invite code");
}

export function markGhl(
  id: string,
  status: RegisterInterestRow["ghl_status"],
  contactId: string | null,
  error: string | null,
): void {
  const db = registerInterestDb();
  if (!db) return;
  db.prepare(
    `UPDATE register_interest
        SET ghl_status = ?, ghl_contact_id = COALESCE(?, ghl_contact_id),
            ghl_error = ?, ghl_attempts = ghl_attempts + 1, updated_at = ?
      WHERE id = ?`,
  ).run(status, contactId, error ? error.slice(0, 300) : null, Date.now(), id);
}

/**
 * Remove a person's row for a tournament (privacy request). Returns the
 * number of rows removed. The HighLevel contact is removed by hand in
 * the CRM; this only covers the local copy.
 */
export function deleteRegisterInterest(tournamentId: string, email: string): number {
  const db = registerInterestDb();
  if (!db) return 0;
  const r = db
    .prepare(`DELETE FROM register_interest WHERE tournament_id = ? AND email = ?`)
    .run(tournamentId, email.trim().toLowerCase());
  return r.changes;
}

/** Does an invite code exist? Used to validate ?ref= before storing it. */
export function inviteCodeExists(code: string): boolean {
  const db = registerInterestDb();
  if (!db) return false;
  const r = db
    .prepare(`SELECT 1 FROM register_interest WHERE invite_code = ?`)
    .get(code);
  return Boolean(r);
}

/** Number of verified signups that used this person's code. Own-referral
 *  progress is the one count the loop is allowed to show (it is the
 *  person's own number, not a platform total). */
export function referralCount(code: string): number {
  const db = registerInterestDb();
  if (!db) return 0;
  const r = db
    .prepare(
      `SELECT COUNT(*) AS n FROM register_interest WHERE referred_by_code = ?`,
    )
    .get(code) as { n: number } | undefined;
  return r?.n ?? 0;
}
