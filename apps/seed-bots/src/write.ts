/**
 * Three-store writer.
 *
 * Idempotent on the deterministic bot id (`bot_<8-char-base32>`). Re-runs
 * with the same master seed overwrite existing rows in place; `--purge`
 * wipes every `bot_%` row in every store.
 *
 * Stores touched:
 *   1. apps/auth-sms `user` table (with `is_bot=1`). We add the
 *      `is_bot` column defensively if Agent A1's migration has not
 *      landed yet so this CLI is order-independent.
 *   2. apps/identity humanness JSONL (`humanness-scores.jsonl`). One
 *      `{ userId, score: 0, factors: [], computedAt }` entry per bot.
 *   3. apps/game `brackets` table. One row per bot with the locked
 *      payload, locked_at, and a deterministic share_guid.
 *
 * Paths come from env vars with sensible repo-relative defaults so
 * `pnpm --filter seed-bots run seed -- --apply` does the right thing on
 * the dev server without further configuration.
 */

import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import type { Database as DatabaseT } from "better-sqlite3";

import type { Bot } from "./seed.js";
import { loadFixtures, type FixtureRow } from "./brackets.js";

// ---------- path resolution ----------

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..", "..", "..");

function envOr(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

function authDbPath(): string {
  return envOr("AUTH_DB_PATH", resolve(REPO_ROOT, "apps/auth-sms/data/auth.db"));
}

function gameDbPath(): string {
  return envOr("GAME_DB_PATH", resolve(REPO_ROOT, "apps/game/game.db"));
}

function gameMigrationsDir(): string {
  return envOr(
    "GAME_MIGRATIONS_DIR",
    resolve(REPO_ROOT, "apps/game/migrations"),
  );
}

function identityScoresPath(): string {
  return envOr(
    "IDENTITY_SCORES_PATH",
    resolve(REPO_ROOT, "apps/identity/data/humanness-scores.jsonl"),
  );
}

// ---------- helpers ----------

function deriveShareGuid(botId: string): string {
  // 16-char lower-hex, matching the game store's nanoid-style guid.
  return createHash("sha256")
    .update(`${botId}:share-guid`)
    .digest("hex")
    .slice(0, 16);
}

function deriveBracketRowId(botId: string): string {
  return createHash("sha256")
    .update(`${botId}:bracket-row`)
    .digest("hex")
    .slice(0, 22);
}

function buildBracketPayload(args: {
  bracketId: string;
  fixtures: readonly FixtureRow[];
  bot: Bot;
}): string {
  const { bracketId, fixtures, bot } = args;
  const matchPredictions: Record<string, unknown> = {};
  const knockoutPredictions: Record<string, unknown> = {};
  // Map fixture stage -> classifier
  const byMatch = new Map<number, FixtureRow>();
  for (const f of fixtures) byMatch.set(f.match_number, f);

  // Use the LAST save event as the lockedAt for every pick (the
  // bracket is locked as a whole, not per-match, in the seed model).
  const lockSecs =
    bot.timeline.save_events_secs[bot.timeline.save_events_secs.length - 1] ??
    bot.timeline.created_at_secs;
  const lockIso = new Date(lockSecs * 1000).toISOString();

  for (const p of bot.bracket.picks) {
    const matchId = String(p.match_number);
    const entry = {
      matchId,
      outcome: p.outcome,
      lockedAt: lockIso,
      source: "live" as const,
    };
    if (p.stage === "group") {
      matchPredictions[matchId] = entry;
    } else {
      knockoutPredictions[matchId] = entry;
    }
  }

  const payload = {
    bracketId,
    matchPredictions,
    knockoutPredictions,
    groupTiebreakers: {},
    version: 1,
    lockedAt: lockIso,
    // Non-standard fields the seed pipeline records for forensics.
    _seed: {
      cup_winner: bot.bracket.cup_winner_team3,
      chalk_score: bot.personality.chalk_score,
      engagement_tier: bot.personality.engagement_tier,
      is_bot: 1,
    },
  };
  return JSON.stringify(payload);
}

// ---------- column / table migration (defensive) ----------

function ensureIsBotColumn(db: DatabaseT): void {
  const cols = db.prepare(`PRAGMA table_info(user)`).all() as Array<{
    name: string;
  }>;
  const has = cols.some((c) => c.name === "is_bot");
  if (!has) {
    db.exec(`ALTER TABLE user ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_is_bot ON user(is_bot)`);
  }
}

// ---------- public API ----------

export interface WriteStats {
  readonly users_written: number;
  readonly humanness_written: number;
  readonly brackets_written: number;
}

export function writeBots(bots: readonly Bot[]): WriteStats {
  const fixtures = loadFixtures();

  // ----- auth-sms users -----
  const authPath = authDbPath();
  mkdirSync(dirname(authPath), { recursive: true });
  const authDb = new Database(authPath);
  authDb.pragma("journal_mode = WAL");
  authDb.pragma("foreign_keys = ON");
  // We don't run the full auth-sms schema here; if the user table
  // doesn't exist the auth service has never booted on this DB so
  // there's nothing to seed against. Create the minimal shape.
  authDb.exec(`
    CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY,
      phone TEXT,
      display_name TEXT,
      country TEXT,
      telegram_id INTEGER,
      telegram_username TEXT,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      email TEXT,
      first_name TEXT,
      last_name TEXT,
      city TEXT,
      favourite_team_code TEXT,
      highlevel_contact_id TEXT,
      highlevel_synced_at INTEGER
    );
  `);
  ensureIsBotColumn(authDb);

  const upsertUser = authDb.prepare(`
    INSERT INTO user (
      id, phone, display_name, country, created_at, last_seen_at,
      first_name, last_name, favourite_team_code, is_bot
    ) VALUES (
      @id, NULL, @display_name, @country, @created_at, @last_seen_at,
      @first_name, @last_name, @favourite_team_code, 1
    )
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      country = excluded.country,
      last_seen_at = excluded.last_seen_at,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      favourite_team_code = excluded.favourite_team_code,
      is_bot = 1
  `);

  const userTx = authDb.transaction((rows: ReadonlyArray<Bot>) => {
    for (const bot of rows) {
      upsertUser.run({
        id: bot.bot_id,
        display_name: bot.identity.display_name,
        country: bot.identity.country.toUpperCase(),
        created_at: bot.timeline.created_at_secs,
        last_seen_at: bot.timeline.created_at_secs,
        first_name: bot.identity.first_name,
        last_name: bot.identity.last_name,
        favourite_team_code: bot.favourite_team3,
      });
    }
  });
  userTx(bots);
  const usersWritten = bots.length;
  authDb.close();

  // ----- identity humanness JSONL -----
  const scoresPath = identityScoresPath();
  mkdirSync(dirname(scoresPath), { recursive: true });
  // Idempotency: if the file already lists this bot at score=0, skip.
  // Cheap one-time read; the seed run only happens occasionally.
  const existing = readExistingScoreUserIds(scoresPath);
  let humannessWritten = 0;
  for (const bot of bots) {
    if (existing.has(bot.bot_id)) continue;
    const snap = {
      userId: bot.bot_id,
      score: 0,
      factors: [
        {
          id: "seed_bot",
          weight: 1,
          value: 0,
          contribution: 0,
          note: "cosmetic seed bot; is_bot=1",
        },
      ],
      computedAt: bot.timeline.created_at_secs * 1000,
    };
    appendFileSync(scoresPath, `${JSON.stringify(snap)}\n`);
    humannessWritten++;
  }

  // ----- game brackets -----
  const gamePath = gameDbPath();
  mkdirSync(dirname(gamePath), { recursive: true });
  const gameDb = new Database(gamePath);
  gameDb.pragma("journal_mode = WAL");
  gameDb.pragma("foreign_keys = ON");
  applyGameMigrations(gameDb);
  ensureBracketsShape(gameDb);

  const upsertGameUser = gameDb.prepare(
    `INSERT INTO users (id, created_at) VALUES (?, ?)
       ON CONFLICT(id) DO NOTHING`,
  );
  const upsertBracket = gameDb.prepare(`
    INSERT INTO brackets (
      id, user_id, tournament_id, payload_json, locked_at, score_total, share_guid
    ) VALUES (
      @id, @user_id, @tournament_id, @payload_json, @locked_at, 0, @share_guid
    )
    ON CONFLICT(id) DO UPDATE SET
      payload_json = excluded.payload_json,
      locked_at = excluded.locked_at,
      share_guid = excluded.share_guid
  `);

  let bracketsWritten = 0;
  const tournamentId = "fifa-wc-2026";

  const bracketTx = gameDb.transaction((rows: ReadonlyArray<Bot>) => {
    for (const bot of rows) {
      const bracketId = deriveBracketRowId(bot.bot_id);
      const shareGuid = deriveShareGuid(bot.bot_id);
      const lockSecs =
        bot.timeline.save_events_secs[bot.timeline.save_events_secs.length - 1] ??
        bot.timeline.created_at_secs;
      upsertGameUser.run(bot.bot_id, bot.timeline.created_at_secs * 1000);
      upsertBracket.run({
        id: bracketId,
        user_id: bot.bot_id,
        tournament_id: tournamentId,
        payload_json: buildBracketPayload({ bracketId, fixtures, bot }),
        locked_at: lockSecs * 1000, // ms, matches existing brackets.locked_at
        share_guid: shareGuid,
      });
      bracketsWritten++;
    }
  });
  bracketTx(bots);
  gameDb.close();

  return {
    users_written: usersWritten,
    humanness_written: humannessWritten,
    brackets_written: bracketsWritten,
  };
}

// ---------- purge ----------

export interface PurgeStats {
  readonly users_deleted: number;
  readonly humanness_lines_dropped: number;
  readonly brackets_deleted: number;
}

export function purgeBots(): PurgeStats {
  // Auth-sms users.
  const authDb = new Database(authDbPath());
  let usersDeleted = 0;
  const authHasUserTable = authDb
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='user'`,
    )
    .get();
  if (authHasUserTable) {
    const r = authDb.prepare(`DELETE FROM user WHERE id LIKE 'bot_%'`).run();
    usersDeleted = r.changes ?? 0;
  }
  authDb.close();

  // Identity scores JSONL: rewrite without bot rows.
  let linesDropped = 0;
  const scoresPath = identityScoresPath();
  if (existsSync(scoresPath)) {
    const raw = readFileSync(scoresPath, "utf8");
    const lines = raw.split("\n");
    const kept: string[] = [];
    for (const line of lines) {
      if (!line.trim()) {
        kept.push(line);
        continue;
      }
      try {
        const obj = JSON.parse(line) as { userId?: string };
        if (typeof obj.userId === "string" && obj.userId.startsWith("bot_")) {
          linesDropped++;
          continue;
        }
      } catch {
        // keep unparseable line so we never lose data
      }
      kept.push(line);
    }
    // Rewrite atomically.
    writeFileSync(`${scoresPath}.tmp`, kept.join("\n"));
    renameSync(`${scoresPath}.tmp`, scoresPath);
  }

  // Game brackets + users.
  const gameDb = new Database(gameDbPath());
  let bracketsDeleted = 0;
  const gameHasBrackets = gameDb
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='brackets'`,
    )
    .get();
  if (gameHasBrackets) {
    const r = gameDb
      .prepare(`DELETE FROM brackets WHERE user_id LIKE 'bot_%'`)
      .run();
    bracketsDeleted = r.changes ?? 0;
    gameDb.prepare(`DELETE FROM users WHERE id LIKE 'bot_%'`).run();
  }
  gameDb.close();

  return {
    users_deleted: usersDeleted,
    humanness_lines_dropped: linesDropped,
    brackets_deleted: bracketsDeleted,
  };
}

// ---------- internal: identity dedupe ----------

function readExistingScoreUserIds(path: string): Set<string> {
  const out = new Set<string>();
  if (!existsSync(path)) return out;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as { userId?: string };
      if (typeof o.userId === "string") out.add(o.userId);
    } catch {
      /* ignore corrupt line */
    }
  }
  return out;
}

// ---------- internal: game schema bootstrap ----------

/**
 * Apply game migrations from `apps/game/migrations/` if the migrations
 * table is missing or out of date. We mirror the migration runner in
 * `apps/game/src/store/db.ts` so a never-booted dev DB acquires a
 * working schema without first starting the game service.
 */
function applyGameMigrations(db: DatabaseT): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
  const dir = gameMigrationsDir();
  if (!existsSync(dir)) return; // tests with mocked DB path
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const applied = new Set(
    (db.prepare(`SELECT id FROM _migrations`).all() as { id: string }[]).map(
      (r) => r.id,
    ),
  );
  const insert = db.prepare(
    `INSERT INTO _migrations (id, applied_at) VALUES (?, ?)`,
  );
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(resolve(dir, f), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      insert.run(f, Date.now());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

/**
 * Defensive: the brackets table is created by migration 0001 in the
 * game service. If anything went sideways we still want the seed run
 * to surface a clear error rather than crash with a SQL syntax error.
 */
function ensureBracketsShape(db: DatabaseT): void {
  const tbl = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='brackets'`,
    )
    .get();
  if (!tbl) {
    throw new Error(
      "game DB is missing `brackets` table. Run the game service " +
        "once to apply migrations, then re-run the seed CLI.",
    );
  }
  const cols = db.prepare(`PRAGMA table_info(brackets)`).all() as Array<{
    name: string;
  }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("share_guid")) {
    db.exec(`ALTER TABLE brackets ADD COLUMN share_guid TEXT`);
  }
}
