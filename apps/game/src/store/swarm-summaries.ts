/**
 * Swarm-summary DAO , operator-keyed aggregate snapshots published by
 * each swarm operator (browser tab or Node operator) once per kickoff.
 *
 * Spec: A13 task brief.
 *
 * The operator_id is the sha256 hash of the operator's API key , the
 * same hash stored in `api_key.key_hash` , so the profile aggregate
 * naturally rolls up every summary posted under that key without
 * inventing a second identity column.
 *
 * Idempotency: (operator_id, kickoff_at) is the natural primary key.
 * Re-POSTing the same payload overwrites the prior row so a recovering
 * client can re-publish after a transient network failure without
 * duplicating leaderboard entries.
 */
import type { Database as DatabaseT } from "better-sqlite3";

export interface AliveAfterMatch {
  /** 1-indexed match ordinal in the canonical fixture order. */
  n: number;
  /** Number of bots in this swarm still on a perfect track at match n. */
  alive_count: number;
}

export interface TopKEntry {
  bot_id: string;
  /** 0..104 , match-count this bot has nailed. */
  score: number;
  /** Pre-tournament chalk-weighted heuristic score. */
  chalk_score: number;
}

export interface SwarmSummaryRow {
  operator_id: string;
  kickoff_at: number;
  total_bots: number;
  alive_by_match_json: string;
  best_bot_score: number;
  top_k_json: string;
  merkle_root: string;
  generated_at: number;
}

export interface ParsedSwarmSummary {
  operator_id: string;
  kickoff_at: number;
  total_bots: number;
  bots_alive_after_match_n: AliveAfterMatch[];
  best_bot_score: number;
  top_k: TopKEntry[];
  merkle_root: string;
  generated_at: number;
}

export interface UpsertSummaryParams {
  operator_id: string;
  kickoff_at: number;
  total_bots: number;
  bots_alive_after_match_n: readonly AliveAfterMatch[];
  best_bot_score: number;
  top_k: readonly TopKEntry[];
  merkle_root: string;
  generated_at: number;
}

const MAX_TOP_K = 1_000;
const MAX_ALIVE_ROWS = 200; // generous ceiling over the 104-match cap

export class SwarmSummaryStore {
  constructor(private readonly db: DatabaseT) {}

  /**
   * Insert (or overwrite) the summary keyed by (operator_id,
   * kickoff_at). The store enforces the top_k and
   * bots_alive_after_match_n size caps so a misbehaving client
   * cannot blow up the row size.
   */
  upsert(p: UpsertSummaryParams): SwarmSummaryRow {
    const top_k = p.top_k.slice(0, MAX_TOP_K);
    const alive = p.bots_alive_after_match_n.slice(0, MAX_ALIVE_ROWS);
    this.db
      .prepare(
        `INSERT INTO swarm_summary
           (operator_id, kickoff_at, total_bots,
            alive_by_match_json, best_bot_score, top_k_json,
            merkle_root, generated_at)
         VALUES (@operator_id, @kickoff_at, @total_bots,
                 @alive_by_match_json, @best_bot_score, @top_k_json,
                 @merkle_root, @generated_at)
         ON CONFLICT(operator_id, kickoff_at) DO UPDATE SET
           total_bots          = excluded.total_bots,
           alive_by_match_json = excluded.alive_by_match_json,
           best_bot_score      = excluded.best_bot_score,
           top_k_json          = excluded.top_k_json,
           merkle_root         = excluded.merkle_root,
           generated_at        = excluded.generated_at`,
      )
      .run({
        operator_id: p.operator_id,
        kickoff_at: p.kickoff_at,
        total_bots: p.total_bots,
        alive_by_match_json: JSON.stringify(alive),
        best_bot_score: p.best_bot_score,
        top_k_json: JSON.stringify(top_k),
        merkle_root: p.merkle_root,
        generated_at: p.generated_at,
      });
    return this.getByCompositeKey(p.operator_id, p.kickoff_at)!;
  }

  getByCompositeKey(
    operator_id: string,
    kickoff_at: number,
  ): SwarmSummaryRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM swarm_summary
           WHERE operator_id = ? AND kickoff_at = ?`,
      )
      .get(operator_id, kickoff_at) as SwarmSummaryRow | undefined;
    return row ?? null;
  }

  /** Latest summary for this operator. Used by GET /v1/swarms/<id>. */
  getLatestForOperator(operator_id: string): SwarmSummaryRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM swarm_summary
           WHERE operator_id = ?
           ORDER BY kickoff_at DESC, generated_at DESC
           LIMIT 1`,
      )
      .get(operator_id) as SwarmSummaryRow | undefined;
    return row ?? null;
  }

  /** Time-series of best scores per kickoff for the profile sparkline. */
  listForOperator(operator_id: string, limit = 100): SwarmSummaryRow[] {
    return this.db
      .prepare(
        `SELECT * FROM swarm_summary
           WHERE operator_id = ?
           ORDER BY kickoff_at ASC
           LIMIT ?`,
      )
      .all(operator_id, limit) as SwarmSummaryRow[];
  }

  /**
   * Top-N operators across the platform, ranked by best_bot_score.
   * One row per operator , we collapse to the latest summary per
   * operator inside the query so the global leaderboard never
   * double-counts. Used by GET /v1/swarms.
   */
  topOperators(limit: number): SwarmSummaryRow[] {
    return this.db
      .prepare(
        `SELECT s.*
           FROM swarm_summary s
           INNER JOIN (
             SELECT operator_id, MAX(kickoff_at) AS latest
               FROM swarm_summary
              GROUP BY operator_id
           ) latest
             ON latest.operator_id = s.operator_id
            AND latest.latest = s.kickoff_at
          ORDER BY s.best_bot_score DESC, s.generated_at DESC
          LIMIT ?`,
      )
      .all(limit) as SwarmSummaryRow[];
  }

  /**
   * Aggregate totals across every operator's latest summary. Surfaced
   * through the /v1/swarm/totals "bots in the arena" headline so
   * federation-mode operators (browser tabs at /run, bot-node Docker
   * containers, anything that posts to /v1/swarms/<id>/summary) get
   * folded in alongside the older swarm_claims tally.
   */
  totals(): { total_bots: number; total_operators: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total_operators, COALESCE(SUM(latest_total), 0) AS total_bots
           FROM (
             SELECT operator_id, total_bots AS latest_total
               FROM swarm_summary s
              WHERE kickoff_at = (
                SELECT MAX(kickoff_at) FROM swarm_summary s2
                 WHERE s2.operator_id = s.operator_id
              )
              GROUP BY operator_id
           )`,
      )
      .get() as { total_bots: number; total_operators: number };
    return {
      total_bots: Number(row.total_bots ?? 0),
      total_operators: Number(row.total_operators ?? 0),
    };
  }

  /**
   * Latest summary per operator. Used by the perfect-track watcher to
   * find any operator still carrying alive bots past match 80.
   */
  latestPerOperator(): SwarmSummaryRow[] {
    return this.db
      .prepare(
        `SELECT s.*
           FROM swarm_summary s
           INNER JOIN (
             SELECT operator_id, MAX(kickoff_at) AS latest
               FROM swarm_summary
              GROUP BY operator_id
           ) latest
             ON latest.operator_id = s.operator_id
            AND latest.latest = s.kickoff_at`,
      )
      .all() as SwarmSummaryRow[];
  }

  parseAlive(row: SwarmSummaryRow): AliveAfterMatch[] {
    try {
      const parsed = JSON.parse(row.alive_by_match_json);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (x): x is AliveAfterMatch =>
          x &&
          typeof x === "object" &&
          typeof (x as AliveAfterMatch).n === "number" &&
          typeof (x as AliveAfterMatch).alive_count === "number",
      );
    } catch {
      return [];
    }
  }

  parseTopK(row: SwarmSummaryRow): TopKEntry[] {
    try {
      const parsed = JSON.parse(row.top_k_json);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (x): x is TopKEntry =>
          x &&
          typeof x === "object" &&
          typeof (x as TopKEntry).bot_id === "string" &&
          typeof (x as TopKEntry).score === "number",
      );
    } catch {
      return [];
    }
  }

  /** Convenience: parse a row into the public response shape. */
  parse(row: SwarmSummaryRow): ParsedSwarmSummary {
    return {
      operator_id: row.operator_id,
      kickoff_at: row.kickoff_at,
      total_bots: row.total_bots,
      bots_alive_after_match_n: this.parseAlive(row),
      best_bot_score: row.best_bot_score,
      top_k: this.parseTopK(row),
      merkle_root: row.merkle_root,
      generated_at: row.generated_at,
    };
  }
}

export interface PerfectTrackAlertRow {
  operator_id: string;
  match_number: number;
  alive_count: number;
  detected_at: number;
}

export class PerfectTrackAlertStore {
  constructor(private readonly db: DatabaseT) {}

  /** Idempotent record of an alert for (operator_id, match_number). */
  recordAlert(p: {
    operator_id: string;
    match_number: number;
    alive_count: number;
    now?: number;
  }): void {
    const detected_at = p.now ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO perfect_track_alert
           (operator_id, match_number, alive_count, detected_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(operator_id, match_number) DO UPDATE SET
           alive_count = excluded.alive_count,
           detected_at = excluded.detected_at`,
      )
      .run(p.operator_id, p.match_number, p.alive_count, detected_at);
  }

  /** Roll-up used by the /leaderboard badge: total alive bots past the
   * highest match number any operator has reached. */
  latestSummary(): { highest_match: number; total_alive: number; operator_count: number } | null {
    const row = this.db
      .prepare(
        `SELECT match_number, SUM(alive_count) AS total_alive,
                COUNT(DISTINCT operator_id) AS operator_count
           FROM perfect_track_alert
          WHERE match_number = (SELECT MAX(match_number) FROM perfect_track_alert)
          GROUP BY match_number`,
      )
      .get() as
      | { match_number: number; total_alive: number; operator_count: number }
      | undefined;
    if (!row) return null;
    return {
      highest_match: row.match_number,
      total_alive: row.total_alive,
      operator_count: row.operator_count,
    };
  }

  listAll(): PerfectTrackAlertRow[] {
    return this.db
      .prepare(
        `SELECT * FROM perfect_track_alert
           ORDER BY match_number DESC, alive_count DESC`,
      )
      .all() as PerfectTrackAlertRow[];
  }
}
