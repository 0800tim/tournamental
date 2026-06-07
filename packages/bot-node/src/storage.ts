import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import type {
  BotPick,
  BotRecord,
  CommitLogRow,
  NodeCredentials,
  Outcome,
} from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bot (
  bot_id TEXT PRIMARY KEY,
  seed TEXT NOT NULL,
  strategy TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_pick (
  bot_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('home_win','draw','away_win')),
  chalk_score REAL NOT NULL,
  locked_at_utc INTEGER NOT NULL,
  committed_at_utc INTEGER,
  PRIMARY KEY (bot_id, match_id)
);
CREATE INDEX IF NOT EXISTS idx_bot_pick_match ON bot_pick(match_id);
CREATE INDEX IF NOT EXISTS idx_bot_pick_committed ON bot_pick(committed_at_utc);

CREATE TABLE IF NOT EXISTS commit_log (
  match_id TEXT PRIMARY KEY,
  merkle_root TEXT NOT NULL,
  bot_count INTEGER NOT NULL,
  kickoff_at_utc INTEGER NOT NULL,
  committed_at_utc INTEGER NOT NULL,
  central_ack_at_utc INTEGER
);

CREATE TABLE IF NOT EXISTS match_result (
  match_id TEXT PRIMARY KEY,
  outcome TEXT NOT NULL,
  resolved_at_utc INTEGER NOT NULL,
  scored_at_utc INTEGER
);

CREATE TABLE IF NOT EXISTS bot_score (
  bot_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  correct INTEGER NOT NULL,
  PRIMARY KEY (bot_id, match_id)
);
CREATE INDEX IF NOT EXISTS idx_bot_score_match ON bot_score(match_id);
`;

export interface StorageOptions {
  /** Filesystem path or `:memory:` for an in-memory store (tests). */
  path: string;
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

  insertBotsBulk(bots: BotRecord[]): void {
    const stmt = this.db.prepare<
      [string, string, string, number]
    >(
      "INSERT OR IGNORE INTO bot (bot_id, seed, strategy, created_at) VALUES (?, ?, ?, ?)",
    );
    const tx = this.db.transaction((rows: BotRecord[]) => {
      for (const b of rows) stmt.run(b.bot_id, b.seed, b.strategy, b.created_at);
    });
    tx(bots);
  }

  insertPicksBulk(picks: BotPick[]): void {
    const stmt = this.db.prepare<
      [string, string, Outcome, number, number, number | null]
    >(
      "INSERT OR REPLACE INTO bot_pick " +
        "(bot_id, match_id, outcome, chalk_score, locked_at_utc, committed_at_utc) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
    );
    const tx = this.db.transaction((rows: BotPick[]) => {
      for (const p of rows) {
        stmt.run(
          p.bot_id,
          p.match_id,
          p.outcome,
          p.chalk_score,
          p.locked_at_utc,
          p.committed_at_utc,
        );
      }
    });
    tx(picks);
  }

  countBots(): number {
    const row = this.db
      .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM bot")
      .get();
    return row?.c ?? 0;
  }

  listBotIds(): string[] {
    const rows = this.db
      .prepare<[], { bot_id: string }>("SELECT bot_id FROM bot ORDER BY bot_id")
      .all();
    return rows.map((r) => r.bot_id);
  }

  listPicksForMatch(matchId: string): BotPick[] {
    return this.db
      .prepare<[string], BotPick>(
        "SELECT bot_id, match_id, outcome, chalk_score, locked_at_utc, committed_at_utc " +
          "FROM bot_pick WHERE match_id = ? ORDER BY bot_id",
      )
      .all(matchId);
  }

  markPicksCommitted(matchId: string, committedAt: number): void {
    this.db
      .prepare<[number, string]>(
        "UPDATE bot_pick SET committed_at_utc = ? WHERE match_id = ? AND committed_at_utc IS NULL",
      )
      .run(committedAt, matchId);
  }

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

  recordResult(matchId: string, outcome: Outcome, resolvedAt: number): void {
    this.db
      .prepare<[string, Outcome, number]>(
        "INSERT OR REPLACE INTO match_result (match_id, outcome, resolved_at_utc) VALUES (?, ?, ?)",
      )
      .run(matchId, outcome, resolvedAt);
  }

  scoreMatch(matchId: string, outcome: Outcome, scoredAt: number): number {
    // Insert one bot_score row per pick on this match. Returns the number of
    // bots correct. Wrapped in a single transaction.
    const insertScore = this.db.prepare<[string, string, number]>(
      "INSERT OR REPLACE INTO bot_score (bot_id, match_id, correct) VALUES (?, ?, ?)",
    );
    const selectPicks = this.db.prepare<[string], { bot_id: string; outcome: Outcome }>(
      "SELECT bot_id, outcome FROM bot_pick WHERE match_id = ?",
    );
    const markScored = this.db.prepare<[number, string]>(
      "UPDATE match_result SET scored_at_utc = ? WHERE match_id = ?",
    );

    // Materialise picks first so we don't hold an iterator open while
    // running INSERTs inside the transaction (better-sqlite3 forbids that).
    const picks = selectPicks.all(matchId);
    let correctCount = 0;
    const tx = this.db.transaction(() => {
      for (const row of picks) {
        const correct = row.outcome === outcome ? 1 : 0;
        if (correct) correctCount++;
        insertScore.run(row.bot_id, matchId, correct);
      }
      markScored.run(scoredAt, matchId);
    });
    tx();
    return correctCount;
  }

  countBotsStillPerfect(): number {
    // A bot is "still perfect" iff every scored row for it is correct AND it
    // has at least one scored row. We compute this against `bot_score`.
    const row = this.db
      .prepare<
        [],
        { c: number }
      >(
        "SELECT COUNT(*) AS c FROM (" +
          " SELECT bot_id FROM bot_score" +
          " GROUP BY bot_id" +
          " HAVING MIN(correct) = 1" +
          ")",
      )
      .get();
    return row?.c ?? 0;
  }

  topBots(matchId: string, limit: number): { bot_id: string; correct_picks: number; still_perfect: boolean }[] {
    // For the just-scored match, surface the top bots by total correct picks
    // across all scored matches. `still_perfect` is whether they have any
    // incorrect picks across their scored history.
    return this.db
      .prepare<
        [number],
        { bot_id: string; correct_picks: number; still_perfect: number }
      >(
        "SELECT bot_id, SUM(correct) AS correct_picks, MIN(correct) AS still_perfect " +
          "FROM bot_score GROUP BY bot_id " +
          "ORDER BY correct_picks DESC, bot_id ASC LIMIT ?",
      )
      .all(limit)
      .map((r) => ({
        bot_id: r.bot_id,
        correct_picks: r.correct_picks,
        still_perfect: r.still_perfect === 1,
      }));
  }
}
