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
}

export interface MatchResultRow {
  match_id: string;
  tournament_id: string;
  outcome: string; // JSON
  recorded_at: number;
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
  private listBracketsByTournamentStmt!: Statement;
  private updateBracketScoreStmt!: Statement;
  private upsertMatchResultStmt!: Statement;
  private getMatchResultStmt!: Statement;
  private listMatchResultsStmt!: Statement;
  private leaderboardStmt!: Statement;
  private leaderboardSyndicateStmt!: Statement;
  private upsertSyndicateMemberStmt!: Statement;

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
      `INSERT INTO brackets (id, user_id, tournament_id, payload_json, locked_at, score_total)
       VALUES (@id, @user_id, @tournament_id, @payload_json, @locked_at, 0)`,
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
  }

  // ---------- users ----------

  ensureUser(userId: string, now = Date.now()): void {
    this.upsertUserStmt.run(userId, now);
  }

  // ---------- brackets ----------

  /**
   * Submit (or re-submit before lock) a user's bracket. Returns the
   * resulting row id. Re-submission on the same (user, tournament) pair
   * replaces the prior payload and resets `score_total` to 0 — the next
   * match-result POST will recompute it.
   */
  upsertBracket(args: {
    bracketId: string;
    userId: string;
    tournamentId: string;
    bracket: Bracket;
    lockedAt: number;
  }): { bracketId: string; created: boolean } {
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
      return { bracketId: existing.id, created: false };
    }
    this.insertBracketStmt.run({
      id: args.bracketId,
      user_id: args.userId,
      tournament_id: args.tournamentId,
      payload_json: payloadJson,
      locked_at: args.lockedAt,
    });
    return { bracketId: args.bracketId, created: true };
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
