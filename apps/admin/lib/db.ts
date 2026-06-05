/**
 * Direct sqlite readers for the admin dashboard.
 *
 * Why direct: doc 62 §4 explicitly allows cross-service reach-in when
 * the services are co-located on the same box. The admin app, auth-sms,
 * and game-service all run on the same host in production, so a
 * read-only sqlite open against their data files is the lowest-friction
 * path to live data — far simpler than implementing /v1/admin/* on
 * apps/api and chaining JWT-signed BFF calls.
 *
 * Connections are cached at module scope (one per file) so we don't
 * pay the open cost on every read. We use SQLite's read-only mode and
 * never write through these handles — every admin write goes through
 * the canonical service's HTTP API.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Database, { type Database as DB } from "better-sqlite3";

function resolveDbPath(envKey: string, fallback: string): string {
  const explicit = process.env[envKey];
  if (explicit && explicit.length > 0) return explicit;
  // The admin app is launched from apps/admin/ by pnpm. Walk up to the
  // repo root and join the fallback so dev (pnpm dev) and prod (next
  // start) both find the same file.
  const root = resolve(process.cwd(), "..", "..");
  return resolve(root, fallback);
}

let _authDb: DB | null = null;
let _authDbRw: DB | null = null;
let _gameDb: DB | null = null;
let _gameDbRw: DB | null = null;
let _oddsDb: DB | null = null;

export function authDb(): DB | null {
  if (_authDb) return _authDb;
  const p = resolveDbPath("ADMIN_AUTH_DB_PATH", "apps/auth-sms/data/auth.db");
  if (!existsSync(p)) {
    // Soft fail: pages fall back to mocks when the DB isn't reachable.
    // eslint-disable-next-line no-console
    console.warn(`[admin/db] auth.db not found at ${p}; falling back to mocks`);
    return null;
  }
  _authDb = new Database(p, { readonly: true, fileMustExist: true });
  _authDb.pragma("journal_mode = WAL");
  return _authDb;
}

export function gameDb(): DB | null {
  if (_gameDb) return _gameDb;
  const p = resolveDbPath("ADMIN_GAME_DB_PATH", "apps/game/data/game.db");
  if (!existsSync(p)) {
    // eslint-disable-next-line no-console
    console.warn(`[admin/db] game.db not found at ${p}; falling back to mocks`);
    return null;
  }
  _gameDb = new Database(p, { readonly: true, fileMustExist: true });
  _gameDb.pragma("journal_mode = WAL");
  return _gameDb;
}

/**
 * Writable game.db connection, used by the small set of admin actions
 * that mutate game-service state directly (currently: approve/deny pool
 * join requests). Kept as a separate connection from {@link gameDb} so
 * the read path stays read-only and any accidental mutation through the
 * read handle fails fast.
 *
 * SQLite + WAL safely supports multiple connections to the same file
 * from a single process; the writable handle uses the same journal mode.
 * Returns null when the database file doesn't exist (mock-mode dev).
 */
export function gameDbWritable(): DB | null {
  if (_gameDbRw) return _gameDbRw;
  const p = resolveDbPath("ADMIN_GAME_DB_PATH", "apps/game/data/game.db");
  if (!existsSync(p)) {
    // eslint-disable-next-line no-console
    console.warn(`[admin/db] game.db not found at ${p}; admin writes disabled`);
    return null;
  }
  _gameDbRw = new Database(p, { readonly: false, fileMustExist: true });
  _gameDbRw.pragma("journal_mode = WAL");
  return _gameDbRw;
}

/**
 * Writable auth.db connection. Mirrors {@link gameDbWritable}'s
 * rationale: kept separate from the readonly handle so accidental
 * writes through the read path still fail fast. Used by admin actions
 * that delete user records (see hardDeleteUser in lib/live.ts).
 */
export function authDbWritable(): DB | null {
  if (_authDbRw) return _authDbRw;
  const p = resolveDbPath("ADMIN_AUTH_DB_PATH", "apps/auth-sms/data/auth.db");
  if (!existsSync(p)) {
    // eslint-disable-next-line no-console
    console.warn(`[admin/db] auth.db not found at ${p}; admin writes disabled`);
    return null;
  }
  _authDbRw = new Database(p, { readonly: false, fileMustExist: true });
  _authDbRw.pragma("journal_mode = WAL");
  return _authDbRw;
}

export function oddsDb(): DB | null {
  if (_oddsDb) return _oddsDb;
  const p = resolveDbPath(
    "ADMIN_ODDS_DB_PATH",
    "apps/odds-ingest/data/odds-ingest.sqlite",
  );
  if (!existsSync(p)) {
    // eslint-disable-next-line no-console
    console.warn(`[admin/db] odds-ingest.sqlite not found at ${p}`);
    return null;
  }
  _oddsDb = new Database(p, { readonly: true, fileMustExist: true });
  _oddsDb.pragma("journal_mode = WAL");
  return _oddsDb;
}

/** Convenience: epoch-ms threshold for "today" (UTC) at the host's clock. */
export function startOfTodayMs(now: number = Date.now()): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/** Epoch-ms threshold for "N days ago" (UTC). */
export function nDaysAgoMs(days: number, now: number = Date.now()): number {
  return now - days * 24 * 60 * 60 * 1000;
}
