/**
 * Game-service SQLite store.
 *
 * Synchronous (better-sqlite3) — matches the read-heavy / single-writer
 * profile of this service the same way `apps/odds-ingest` does.
 *
 * Migrations live in `apps/game/migrations/000N_*.sql` and run on startup
 * via `applyMigrations()`. We track applied migrations in a `_migrations`
 * table so re-running the service is idempotent.
 */

import { mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import type { Database as DatabaseT, Statement } from "better-sqlite3";

import type { Bracket } from "../types.js";

export interface GameStoreOptions {
  /** Filesystem path to the SQLite file. ":memory:" for tests. */
  dbPath: string;
  /**
   * Optional override of the migrations directory. Used by tests so they
   * can point at the canonical one regardless of cwd.
   */
  migrationsDir?: string;
}

export interface BracketRow {
  id: string;
  user_id: string;
  tournament_id: string;
  payload_json: string;
  locked_at: number;
  score_total: number;
  /** Public opaque share guid (added by migration 0004). Always present
   *  on rows written after migration; rows that pre-date the migration
   *  have it backfilled with a 16-char hex string. */
  share_guid: string | null;
}

export interface MatchResultRow {
  match_id: string;
  tournament_id: string;
  outcome: string; // JSON
  recorded_at: number;
}

export interface TournamentRow {
  id: string;
  name: string | null;
  settled_at: number | null;
  created_at: number;
}

export interface VerifiedPunditRecordRow {
  user_id: string;
  tournament_id: string;
  final_rank: number;
  score_total: number;
  stamped_at: number;
}

export class GameStore {
  readonly db: DatabaseT;
  private readonly migrationsDir: string;

  // Prepared statements
  private upsertUserStmt!: Statement;
  private insertBracketStmt!: Statement;
  private updateBracketStmt!: Statement;
  private getBracketByUserStmt!: Statement;
  private getBracketByIdStmt!: Statement;
  private getBracketByShareGuidStmt!: Statement;
  private listBracketsByTournamentStmt!: Statement;
  private updateBracketScoreStmt!: Statement;
  private upsertMatchResultStmt!: Statement;
  private getMatchResultStmt!: Statement;
  private listMatchResultsStmt!: Statement;
  private leaderboardStmt!: Statement;
  private leaderboardSyndicateStmt!: Statement;
  private upsertSyndicateMemberStmt!: Statement;
  private upsertTournamentStmt!: Statement;
  private setTournamentSettledStmt!: Statement;
  private getTournamentStmt!: Statement;
  private listSettledTournamentsStmt!: Statement;
  private upsertPunditRecordStmt!: Statement;
  private listPunditRecordsForUserStmt!: Statement;
  private deletePunditRecordsForTournamentStmt!: Statement;

  constructor(opts: GameStoreOptions) {
    if (opts.dbPath !== ":memory:") {
      mkdirSync(dirname(resolve(opts.dbPath)), { recursive: true });
    }
    this.db = new Database(opts.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");

    this.migrationsDir = opts.migrationsDir ?? defaultMigrationsDir();
    this.applyMigrations();
    this.prepareStatements();
  }

  // ---------- migrations ----------

  private applyMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id        TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);
    if (!existsSync(this.migrationsDir)) {
      throw new Error(`Migrations directory not found: ${this.migrationsDir}`);
    }
    const files = readdirSync(this.migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const applied = new Set(
      (this.db.prepare(`SELECT id FROM _migrations`).all() as { id: string }[]).map(
        (r) => r.id,
      ),
    );
    const insertMigration = this.db.prepare(
      `INSERT INTO _migrations (id, applied_at) VALUES (?, ?)`,
    );
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(this.migrationsDir, file), "utf8");
      this.db.exec("BEGIN");
      try {
        this.db.exec(sql);
        insertMigration.run(file, Date.now());
        this.db.exec("COMMIT");
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
    }
  }

  private prepareStatements(): void {
    this.upsertUserStmt = this.db.prepare(
      `INSERT INTO users (id, created_at) VALUES (?, ?)
       ON CONFLICT(id) DO NOTHING`,
    );
    this.insertBracketStmt = this.db.prepare(
      `INSERT INTO brackets (id, user_id, tournament_id, payload_json, locked_at, score_total, share_guid)
       VALUES (@id, @user_id, @tournament_id, @payload_json, @locked_at, 0, @share_guid)`,
    );
    this.updateBracketStmt = this.db.prepare(
      `UPDATE brackets
         SET payload_json = @payload_json,
             locked_at = @locked_at,
             score_total = 0
       WHERE user_id = @user_id AND tournament_id = @tournament_id`,
    );
    this.getBracketByUserStmt = this.db.prepare(
      `SELECT * FROM brackets WHERE user_id = ? AND tournament_id = ?`,
    );
    this.getBracketByIdStmt = this.db.prepare(
      `SELECT * FROM brackets WHERE id = ?`,
    );
    this.getBracketByShareGuidStmt = this.db.prepare(
      `SELECT * FROM brackets WHERE share_guid = ?`,
    );
    this.listBracketsByTournamentStmt = this.db.prepare(
      `SELECT * FROM brackets WHERE tournament_id = ?`,
    );
    this.updateBracketScoreStmt = this.db.prepare(
      `UPDATE brackets SET score_total = ? WHERE id = ?`,
    );
    this.upsertMatchResultStmt = this.db.prepare(
      `INSERT INTO match_results (match_id, tournament_id, outcome, recorded_at)
       VALUES (@match_id, @tournament_id, @outcome, @recorded_at)
       ON CONFLICT(match_id, tournament_id) DO UPDATE SET
         outcome = excluded.outcome,
         recorded_at = excluded.recorded_at`,
    );
    this.getMatchResultStmt = this.db.prepare(
      `SELECT * FROM match_results WHERE match_id = ? AND tournament_id = ?`,
    );
    this.listMatchResultsStmt = this.db.prepare(
      `SELECT * FROM match_results WHERE tournament_id = ?`,
    );
    this.leaderboardStmt = this.db.prepare(
      `SELECT id AS bracket_id, user_id, score_total
         FROM brackets
        WHERE tournament_id = ?
        ORDER BY score_total DESC, locked_at ASC, user_id ASC
        LIMIT ?`,
    );
    this.leaderboardSyndicateStmt = this.db.prepare(
      `SELECT b.id AS bracket_id, b.user_id, b.score_total
         FROM brackets b
         INNER JOIN syndicate_members sm
           ON sm.user_id = b.user_id
        WHERE b.tournament_id = ? AND sm.syndicate_id = ?
        ORDER BY b.score_total DESC, b.locked_at ASC, b.user_id ASC
        LIMIT ?`,
    );
    this.upsertSyndicateMemberStmt = this.db.prepare(
      `INSERT INTO syndicate_members (user_id, syndicate_id, joined_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, syndicate_id) DO NOTHING`,
    );
    this.upsertTournamentStmt = this.db.prepare(
      `INSERT INTO tournaments (id, name, settled_at, created_at)
       VALUES (@id, @name, @settled_at, @created_at)
       ON CONFLICT(id) DO UPDATE SET
         name = COALESCE(excluded.name, tournaments.name)`,
    );
    this.setTournamentSettledStmt = this.db.prepare(
      `UPDATE tournaments SET settled_at = ? WHERE id = ?`,
    );
    this.getTournamentStmt = this.db.prepare(
      `SELECT * FROM tournaments WHERE id = ?`,
    );
    this.listSettledTournamentsStmt = this.db.prepare(
      `SELECT * FROM tournaments WHERE settled_at IS NOT NULL ORDER BY settled_at ASC`,
    );
    this.upsertPunditRecordStmt = this.db.prepare(
      `INSERT INTO verified_pundit_records (user_id, tournament_id, final_rank, score_total, stamped_at)
       VALUES (@user_id, @tournament_id, @final_rank, @score_total, @stamped_at)
       ON CONFLICT(user_id, tournament_id) DO UPDATE SET
         final_rank = excluded.final_rank,
         score_total = excluded.score_total,
         stamped_at = excluded.stamped_at`,
    );
    this.listPunditRecordsForUserStmt = this.db.prepare(
      `SELECT * FROM verified_pundit_records WHERE user_id = ? ORDER BY stamped_at ASC`,
    );
    this.deletePunditRecordsForTournamentStmt = this.db.prepare(
      `DELETE FROM verified_pundit_records WHERE tournament_id = ?`,
    );
  }

  // ---------- users ----------

  ensureUser(userId: string, now = Date.now()): void {
    this.upsertUserStmt.run(userId, now);
  }

  // ---------- brackets ----------

  /**
   * Submit (or re-submit before lock) a user's bracket. Returns the
   * resulting row id and the share guid (whether existing or newly
   * minted). Re-submission on the same (user, tournament) pair
   * replaces the prior payload and resets `score_total` to 0 — the
   * next match-result POST will recompute it. The share guid is
   * STABLE across re-saves: a re-submit never changes it.
   *
   * `shareGuid` (optional) lets the caller supply a client-minted
   * UUID v4 for new brackets. If absent, the store mints a 16-char
   * hex nanoid-style id locally. On update, this argument is ignored
   * — the existing row's share guid wins so the share URL stays
   * stable across re-saves of the same bracket.
   */
  upsertBracket(args: {
    bracketId: string;
    userId: string;
    tournamentId: string;
    bracket: Bracket;
    lockedAt: number;
    shareGuid?: string | null;
  }): { bracketId: string; created: boolean; shareGuid: string } {
    this.ensureUser(args.userId, args.lockedAt);
    const existing = this.getBracketByUserStmt.get(args.userId, args.tournamentId) as
      | BracketRow
      | undefined;
    const payloadJson = JSON.stringify(args.bracket);
    if (existing) {
      this.updateBracketStmt.run({
        payload_json: payloadJson,
        locked_at: args.lockedAt,
        user_id: args.userId,
        tournament_id: args.tournamentId,
      });
      // Defensive: the 0004 backfill should have populated this for
      // every row, but if we somehow have an empty value here, mint
      // one in place so the response always carries a guid back.
      let shareGuid = existing.share_guid;
      if (!shareGuid) {
        shareGuid = generateShortGuid();
        this.db
          .prepare(`UPDATE brackets SET share_guid = ? WHERE id = ?`)
          .run(shareGuid, existing.id);
      }
      return { bracketId: existing.id, created: false, shareGuid };
    }
    const shareGuid =
      (args.shareGuid && args.shareGuid.trim()) || generateShortGuid();
    this.insertBracketStmt.run({
      id: args.bracketId,
      user_id: args.userId,
      tournament_id: args.tournamentId,
      payload_json: payloadJson,
      locked_at: args.lockedAt,
      share_guid: shareGuid,
    });
    return { bracketId: args.bracketId, created: true, shareGuid };
  }

  /** Lookup by the public share guid. Returns null if no row matches. */
  getBracketByShareGuid(shareGuid: string): BracketRow | null {
    const row = this.getBracketByShareGuidStmt.get(shareGuid) as
      | BracketRow
      | undefined;
    return row ?? null;
  }

  /**
   * Returns true iff the share guid is already used by a row OTHER
   * than the one identified by `(userId, tournamentId)`. The save
   * endpoint uses this to reject client-supplied guids that collide
   * with somebody else's bracket. Re-using your own guid on a re-save
   * of your own bracket is fine — that's the whole point.
   */
  isShareGuidTakenByOther(
    shareGuid: string,
    userId: string,
    tournamentId: string,
  ): boolean {
    const row = this.getBracketByShareGuid(shareGuid);
    if (!row) return false;
    return row.user_id !== userId || row.tournament_id !== tournamentId;
  }

  getBracketForUser(
    userId: string,
    tournamentId: string,
  ): BracketRow | null {
    const row = this.getBracketByUserStmt.get(userId, tournamentId) as
      | BracketRow
      | undefined;
    return row ?? null;
  }

  getBracketById(bracketId: string): BracketRow | null {
    const row = this.getBracketByIdStmt.get(bracketId) as BracketRow | undefined;
    return row ?? null;
  }

  listBracketsForTournament(tournamentId: string): BracketRow[] {
    return this.listBracketsByTournamentStmt.all(tournamentId) as BracketRow[];
  }

  updateBracketScore(bracketId: string, score: number): void {
    this.updateBracketScoreStmt.run(score, bracketId);
  }

  // ---------- match results ----------

  upsertMatchResult(args: {
    matchId: string;
    tournamentId: string;
    outcome: unknown;
    recordedAt: number;
  }): void {
    this.upsertMatchResultStmt.run({
      match_id: args.matchId,
      tournament_id: args.tournamentId,
      outcome: JSON.stringify(args.outcome),
      recorded_at: args.recordedAt,
    });
  }

  getMatchResult(
    matchId: string,
    tournamentId: string,
  ): MatchResultRow | null {
    const row = this.getMatchResultStmt.get(matchId, tournamentId) as
      | MatchResultRow
      | undefined;
    return row ?? null;
  }

  listMatchResults(tournamentId: string): MatchResultRow[] {
    return this.listMatchResultsStmt.all(tournamentId) as MatchResultRow[];
  }

  // ---------- leaderboards ----------

  topN(tournamentId: string, n: number): BracketRow[] {
    return this.leaderboardStmt.all(tournamentId, n) as BracketRow[];
  }

  topNForSyndicate(
    tournamentId: string,
    syndicateId: string,
    n: number,
  ): BracketRow[] {
    return this.leaderboardSyndicateStmt.all(
      tournamentId,
      syndicateId,
      n,
    ) as BracketRow[];
  }

  // ---------- syndicate ----------

  addSyndicateMember(userId: string, syndicateId: string, now = Date.now()): void {
    this.ensureUser(userId, now);
    this.upsertSyndicateMemberStmt.run(userId, syndicateId, now);
  }

  // ---------- tournaments ----------

  /**
   * Register a tournament (idempotent). Used when admin marks a tournament
   * as settled so the verified-pundit compute has something to scan. Pure
   * insert/update; does not touch settled_at unless `settledAt` is given.
   */
  upsertTournament(args: {
    id: string;
    name?: string | null;
    settledAt?: number | null;
    now?: number;
  }): void {
    const now = args.now ?? Date.now();
    this.upsertTournamentStmt.run({
      id: args.id,
      name: args.name ?? null,
      settled_at: args.settledAt ?? null,
      created_at: now,
    });
    if (args.settledAt !== undefined && args.settledAt !== null) {
      this.setTournamentSettledStmt.run(args.settledAt, args.id);
    }
  }

  markTournamentSettled(tournamentId: string, settledAt: number = Date.now()): void {
    // Make sure the row exists, then stamp settled_at.
    this.upsertTournamentStmt.run({
      id: tournamentId,
      name: null,
      settled_at: settledAt,
      created_at: settledAt,
    });
    this.setTournamentSettledStmt.run(settledAt, tournamentId);
  }

  getTournament(tournamentId: string): TournamentRow | null {
    const row = this.getTournamentStmt.get(tournamentId) as TournamentRow | undefined;
    return row ?? null;
  }

  listSettledTournaments(): TournamentRow[] {
    return this.listSettledTournamentsStmt.all() as TournamentRow[];
  }

  // ---------- verified pundit ----------

  upsertPunditRecord(args: {
    userId: string;
    tournamentId: string;
    finalRank: number;
    scoreTotal: number;
    stampedAt: number;
  }): void {
    this.upsertPunditRecordStmt.run({
      user_id: args.userId,
      tournament_id: args.tournamentId,
      final_rank: args.finalRank,
      score_total: args.scoreTotal,
      stamped_at: args.stampedAt,
    });
  }

  listPunditRecordsForUser(userId: string): VerifiedPunditRecordRow[] {
    return this.listPunditRecordsForUserStmt.all(userId) as VerifiedPunditRecordRow[];
  }

  clearPunditRecordsForTournament(tournamentId: string): void {
    this.deletePunditRecordsForTournamentStmt.run(tournamentId);
  }

  // ---------- lifecycle ----------

  /** Run a synchronous transaction. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  isHealthy(): boolean {
    try {
      this.db.prepare("SELECT 1").get();
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.db.close();
  }
}

function defaultMigrationsDir(): string {
  // Resolve relative to this source file so the location is stable
  // whether we're running via tsx (src) or node (dist).
  const here = dirname(fileURLToPath(import.meta.url));
  // src/store/db.ts → ../../migrations
  // dist/store/db.js → ../../migrations
  return resolve(here, "..", "..", "migrations");
}

/**
 * 16-char lower-hex share guid. Matches the nanoid shape accepted by
 * the web client (`/^[a-zA-Z0-9_-]{16}$/`) and the backfill format the
 * 0004 migration uses for legacy rows. No third-party nanoid
 * dependency — Node's webcrypto is available everywhere we run.
 */
function generateShortGuid(): string {
  const bytes = new Uint8Array(8);
  const wc = (
    globalThis as {
      crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array };
    }
  ).crypto;
  if (wc && typeof wc.getRandomValues === "function") {
    wc.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = "";
  for (const b of bytes) out += (b ?? 0).toString(16).padStart(2, "0");
  return out;
}
