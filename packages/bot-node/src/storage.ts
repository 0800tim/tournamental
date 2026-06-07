import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import type {
  CommitLogRow,
  NodeCredentials,
  Outcome,
} from "./types.js";

/**
 * Regenerate-on-demand schema (v0.3.0, Tim 2026-06-08).
 *
 * The v0.2.0 schema stored every (bot, match) pick as a separate
 * SQLite row -- which made a million-bot swarm cost ~16 GB on disk
 * (104,000,000 pick rows + indexes + WAL). That defeated the whole
 * point of being able to spawn billions of bots, since the on-disk
 * footprint scaled linearly with bot count.
 *
 * v0.3.0 inverts the contract. A bot is fully reproducible from
 * (run_seed, bot_index, strategy) -- the picks are recomputed via
 * generator.ts whenever scorer.ts or a verifier needs them. The
 * SQLite footprint is now O(swarm_runs + scored_matches), not
 * O(bots), so a billion bots cost ~50 KB instead of 16 TB.
 *
 * What's kept:
 *   - meta             credentials + free-form key/value
 *   - commit_log       merkle root + bot_count per match commit
 *                      (this is what gets POSTed to central and
 *                      anchored to Bitcoin via OpenTimestamps)
 *   - match_result     settled outcomes
 *
 * What's new:
 *   - swarm_run        one row per master_seed: the recipe to
 *                      regenerate every bot in this swarm
 *   - match_score_summary  one row per (match_id, scoring run):
 *                      how many of total_bots picked correctly,
 *                      what the still-perfect count is afterward
 *
 * What's dropped: `bot`, `bot_pick`, `bot_score`. Operators upgrading
 * from 0.2.0 need to wipe the data volume because those tables
 * cannot be migrated forward; nothing in the new flow needs them.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS swarm_run (
  -- Composite identity: (run_seed, strategy). A single seed can be
  -- reused across strategies; each one is its own swarm.
  run_seed         TEXT NOT NULL,
  strategy         TEXT NOT NULL,
  -- Cumulative count of bots in this swarm. Bot indices live in
  -- [0, total_bots). Adding more bots bumps this number; nothing
  -- per-bot is persisted.
  total_bots       INTEGER NOT NULL,
  -- Map of {match_id: per-match merkle root}. NULL until the swarm
  -- has been committed for at least one match. JSON so the schema
  -- doesn't need a per-match-per-swarm row.
  per_match_roots_json TEXT,
  started_at       INTEGER NOT NULL,
  last_updated_at  INTEGER NOT NULL,
  PRIMARY KEY (run_seed, strategy)
);

CREATE TABLE IF NOT EXISTS commit_log (
  match_id          TEXT PRIMARY KEY,
  merkle_root       TEXT NOT NULL,
  bot_count         INTEGER NOT NULL,
  kickoff_at_utc    INTEGER NOT NULL,
  committed_at_utc  INTEGER NOT NULL,
  central_ack_at_utc INTEGER
);

CREATE TABLE IF NOT EXISTS match_result (
  match_id         TEXT PRIMARY KEY,
  outcome          TEXT NOT NULL,
  resolved_at_utc  INTEGER NOT NULL,
  scored_at_utc    INTEGER
);

CREATE TABLE IF NOT EXISTS match_score_summary (
  -- Result of running scorer.ts against this match. One row per
  -- (match_id, swarm) pair; the scorer iterates bot indices and
  -- regenerates each pick on demand.
  match_id                TEXT NOT NULL,
  run_seed                TEXT NOT NULL,
  strategy                TEXT NOT NULL,
  bots_correct            INTEGER NOT NULL,
  bots_still_perfect      INTEGER NOT NULL,
  total_bots_at_score     INTEGER NOT NULL,
  scored_at_utc           INTEGER NOT NULL,
  PRIMARY KEY (match_id, run_seed, strategy)
);
`;

export interface StorageOptions {
  /** Filesystem path or `:memory:` for an in-memory store (tests). */
  path: string;
}

/**
 * Public shape of a swarm_run row. The picks for every bot in the
 * swarm are recomputable from these three fields plus the match
 * catalogue, so no per-bot persistence is needed.
 */
export interface SwarmRunRow {
  run_seed: string;
  strategy: string;
  total_bots: number;
  per_match_roots: Record<string, string>;
  started_at: number;
  last_updated_at: number;
}

export interface MatchScoreSummary {
  match_id: string;
  run_seed: string;
  strategy: string;
  bots_correct: number;
  bots_still_perfect: number;
  total_bots_at_score: number;
  scored_at_utc: number;
}

export class Storage {
  readonly db: Database.Database;

  constructor(opts: StorageOptions) {
    if (opts.path !== ":memory:") {
      mkdirSync(dirname(opts.path), { recursive: true });
    }
    this.db = new Database(opts.path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  getMeta(key: string): string | null {
    const row = this.db
      .prepare<[string], { value: string }>("SELECT value FROM meta WHERE key = ?")
      .get(key);
    return row ? row.value : null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  saveCredentials(creds: NodeCredentials): void {
    this.setMeta("node_id", creds.node_id);
    this.setMeta("node_secret", creds.node_secret);
    this.setMeta("operator_email", creds.operator_email);
    this.setMeta("central_base_url", creds.central_base_url);
    this.setMeta("registered_at_utc", String(creds.registered_at_utc));
  }

  loadCredentials(): NodeCredentials | null {
    const node_id = this.getMeta("node_id");
    const node_secret = this.getMeta("node_secret");
    const operator_email = this.getMeta("operator_email");
    const central_base_url = this.getMeta("central_base_url");
    const registered_at_utc = this.getMeta("registered_at_utc");
    if (!node_id || !node_secret || !operator_email || !central_base_url) {
      return null;
    }
    return {
      node_id,
      node_secret,
      operator_email,
      central_base_url,
      registered_at_utc: registered_at_utc ? Number(registered_at_utc) : 0,
    };
  }

  // ----- swarm_run -----

  getSwarmRun(run_seed: string, strategy: string): SwarmRunRow | null {
    const row = this.db
      .prepare<
        [string, string],
        {
          run_seed: string;
          strategy: string;
          total_bots: number;
          per_match_roots_json: string | null;
          started_at: number;
          last_updated_at: number;
        }
      >(
        "SELECT * FROM swarm_run WHERE run_seed = ? AND strategy = ?",
      )
      .get(run_seed, strategy);
    if (!row) return null;
    return {
      run_seed: row.run_seed,
      strategy: row.strategy,
      total_bots: row.total_bots,
      per_match_roots: row.per_match_roots_json
        ? (JSON.parse(row.per_match_roots_json) as Record<string, string>)
        : {},
      started_at: row.started_at,
      last_updated_at: row.last_updated_at,
    };
  }

  /**
   * Idempotent upsert. If a (run_seed, strategy) row exists, the new
   * total_bots is added to the existing count (so the CLI's incremental
   * `generate --bots=100k` invocations accumulate). per_match_roots
   * replaces the existing map.
   */
  upsertSwarmRun(args: {
    run_seed: string;
    strategy: string;
    total_bots_added: number;
    per_match_roots: Record<string, string>;
    now: number;
  }): SwarmRunRow {
    const existing = this.getSwarmRun(args.run_seed, args.strategy);
    if (existing) {
      const merged: Record<string, string> = {
        ...existing.per_match_roots,
        ...args.per_match_roots,
      };
      const newTotal = existing.total_bots + args.total_bots_added;
      this.db
        .prepare<[number, string, number, string, string]>(
          "UPDATE swarm_run SET total_bots = ?, per_match_roots_json = ?, last_updated_at = ? " +
            "WHERE run_seed = ? AND strategy = ?",
        )
        .run(newTotal, JSON.stringify(merged), args.now, args.run_seed, args.strategy);
      return {
        ...existing,
        total_bots: newTotal,
        per_match_roots: merged,
        last_updated_at: args.now,
      };
    }
    this.db
      .prepare<[string, string, number, string, number, number]>(
        "INSERT INTO swarm_run " +
          "(run_seed, strategy, total_bots, per_match_roots_json, started_at, last_updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        args.run_seed,
        args.strategy,
        args.total_bots_added,
        JSON.stringify(args.per_match_roots),
        args.now,
        args.now,
      );
    return {
      run_seed: args.run_seed,
      strategy: args.strategy,
      total_bots: args.total_bots_added,
      per_match_roots: args.per_match_roots,
      started_at: args.now,
      last_updated_at: args.now,
    };
  }

  listSwarmRuns(): SwarmRunRow[] {
    const rows = this.db
      .prepare<
        [],
        {
          run_seed: string;
          strategy: string;
          total_bots: number;
          per_match_roots_json: string | null;
          started_at: number;
          last_updated_at: number;
        }
      >("SELECT * FROM swarm_run ORDER BY started_at ASC")
      .all();
    return rows.map((r) => ({
      run_seed: r.run_seed,
      strategy: r.strategy,
      total_bots: r.total_bots,
      per_match_roots: r.per_match_roots_json
        ? (JSON.parse(r.per_match_roots_json) as Record<string, string>)
        : {},
      started_at: r.started_at,
      last_updated_at: r.last_updated_at,
    }));
  }

  /**
   * Cumulative bot count across every swarm in this storage. Replaces
   * the v0.2.0 `SELECT COUNT(*) FROM bot` with a single-row sum.
   */
  countBots(): number {
    const row = this.db
      .prepare<[], { c: number }>(
        "SELECT COALESCE(SUM(total_bots), 0) AS c FROM swarm_run",
      )
      .get();
    return row?.c ?? 0;
  }

  // ----- commit_log (unchanged surface) -----

  insertCommitLog(row: CommitLogRow): void {
    this.db
      .prepare<
        [string, string, number, number, number, number | null]
      >(
        "INSERT OR REPLACE INTO commit_log " +
          "(match_id, merkle_root, bot_count, kickoff_at_utc, committed_at_utc, central_ack_at_utc) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.match_id,
        row.merkle_root,
        row.bot_count,
        row.kickoff_at_utc,
        row.committed_at_utc,
        row.central_ack_at_utc,
      );
  }

  ackCommit(matchId: string, ackedAt: number): void {
    this.db
      .prepare<[number, string]>(
        "UPDATE commit_log SET central_ack_at_utc = ? WHERE match_id = ?",
      )
      .run(ackedAt, matchId);
  }

  // ----- match_result / match_score_summary -----

  recordResult(matchId: string, outcome: Outcome, resolvedAt: number): void {
    this.db
      .prepare<[string, Outcome, number]>(
        "INSERT OR REPLACE INTO match_result (match_id, outcome, resolved_at_utc) VALUES (?, ?, ?)",
      )
      .run(matchId, outcome, resolvedAt);
  }

  markMatchScored(matchId: string, scoredAt: number): void {
    this.db
      .prepare<[number, string]>(
        "UPDATE match_result SET scored_at_utc = ? WHERE match_id = ?",
      )
      .run(scoredAt, matchId);
  }

  upsertMatchScoreSummary(s: MatchScoreSummary): void {
    this.db
      .prepare<[string, string, string, number, number, number, number]>(
        "INSERT OR REPLACE INTO match_score_summary " +
          "(match_id, run_seed, strategy, bots_correct, bots_still_perfect, " +
          " total_bots_at_score, scored_at_utc) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        s.match_id,
        s.run_seed,
        s.strategy,
        s.bots_correct,
        s.bots_still_perfect,
        s.total_bots_at_score,
        s.scored_at_utc,
      );
  }

  getMatchScoreSummaries(matchId: string): MatchScoreSummary[] {
    return this.db
      .prepare<[string], MatchScoreSummary>(
        "SELECT match_id, run_seed, strategy, bots_correct, bots_still_perfect, " +
          " total_bots_at_score, scored_at_utc " +
          " FROM match_score_summary WHERE match_id = ? " +
          " ORDER BY run_seed ASC",
      )
      .all(matchId);
  }

  /**
   * Settled matches in chronological order. The scorer uses this to
   * recompute "still perfect" by replaying every settled match
   * through the regenerator for each candidate bot.
   */
  listSettledMatches(): { match_id: string; outcome: Outcome; resolved_at_utc: number }[] {
    return this.db
      .prepare<[], { match_id: string; outcome: Outcome; resolved_at_utc: number }>(
        "SELECT match_id, outcome, resolved_at_utc FROM match_result " +
          " ORDER BY resolved_at_utc ASC",
      )
      .all();
  }
}
