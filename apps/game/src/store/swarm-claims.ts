/**
 * Swarm-claim DAO — durable home of browser-swarm `/v1/swarm/commit`
 * submissions and their OTS proof lifecycle.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §15.6
 */
import type { Database as DatabaseT } from "better-sqlite3";

export type OtsStatus = "pending" | "confirmed" | "failed";

export interface SwarmClaimRow {
  node_id: string;
  run_id: string;
  master_seed: string;
  strategy: string;
  total_bots: number;
  merkle_root: string;
  top_n_claim_json: string;
  claimed_score: number;
  started_at: number;
  finished_at: number;
  submitted_at: number;
  ots_status: OtsStatus;
  pending_calendar_blobs: string;
  upgraded_ots_hex: string | null;
  upgraded_calendar_url: string | null;
  upgraded_at: number | null;
  last_upgrade_attempt_at: number | null;
}

export interface PendingCalendarBlob {
  calendar_url: string;
  pending_bytes_hex: string;
  submitted_at: number;
}

export interface TopNClaim {
  bot_index: number;
  claimed_score: number;
  picks_count: number;
}

export interface UpsertClaimParams {
  node_id: string;
  run_id: string;
  master_seed: string;
  strategy: string;
  total_bots: number;
  merkle_root: string;
  top_n_claim: TopNClaim;
  started_at: number;
  finished_at: number;
  pending_calendar_blobs: readonly PendingCalendarBlob[];
  ots_status?: OtsStatus;
  now?: number;
  /**
   * The signed-in user that owns this swarm. Required for browser
   * submissions on /v1/swarm/commit (Tim 2026-06-08); the route
   * resolves it from the `tnm_session` cookie before calling upsert
   * and rejects anonymous submissions outright. Migration
   * 0016_swarm_claims_user.sql added the column nullable for
   * backward compatibility with any in-flight rows; the totals()
   * aggregator filters those out.
   */
  user_id: string;
}

export interface LeaderboardRow {
  rank: number;
  node_id_short: string;
  bot_index: number;
  claimed_score: number;
  merkle_root: string;
  ots_proof_url: string | null;
  bitcoin_confirmed: boolean;
  submitted_at: number;
}

export class SwarmClaimStore {
  constructor(private readonly db: DatabaseT) {}

  upsert(p: UpsertClaimParams): SwarmClaimRow {
    const submitted_at = p.now ?? Date.now();
    const status: OtsStatus = p.ots_status ?? "pending";
    this.db
      .prepare(
        `INSERT INTO swarm_claims
           (node_id, run_id, master_seed, strategy, total_bots,
            merkle_root, top_n_claim_json, claimed_score,
            started_at, finished_at, submitted_at,
            ots_status, pending_calendar_blobs,
            upgraded_ots_hex, upgraded_calendar_url, upgraded_at,
            last_upgrade_attempt_at, user_id)
         VALUES (@node_id, @run_id, @master_seed, @strategy, @total_bots,
                 @merkle_root, @top_n_claim_json, @claimed_score,
                 @started_at, @finished_at, @submitted_at,
                 @ots_status, @pending_calendar_blobs,
                 NULL, NULL, NULL, NULL, @user_id)
         ON CONFLICT(node_id, run_id) DO UPDATE SET
           master_seed     = excluded.master_seed,
           strategy        = excluded.strategy,
           total_bots      = excluded.total_bots,
           merkle_root     = excluded.merkle_root,
           top_n_claim_json = excluded.top_n_claim_json,
           claimed_score   = excluded.claimed_score,
           started_at      = excluded.started_at,
           finished_at     = excluded.finished_at,
           submitted_at    = excluded.submitted_at,
           ots_status      = excluded.ots_status,
           pending_calendar_blobs = excluded.pending_calendar_blobs,
           user_id         = excluded.user_id`,
      )
      .run({
        node_id: p.node_id,
        run_id: p.run_id,
        master_seed: p.master_seed,
        strategy: p.strategy,
        total_bots: p.total_bots,
        merkle_root: p.merkle_root,
        top_n_claim_json: JSON.stringify(p.top_n_claim),
        claimed_score: p.top_n_claim.claimed_score,
        started_at: p.started_at,
        finished_at: p.finished_at,
        submitted_at,
        ots_status: status,
        pending_calendar_blobs: JSON.stringify(p.pending_calendar_blobs ?? []),
        user_id: p.user_id,
      });
    return this.getByCompositeKey(p.node_id, p.run_id) as SwarmClaimRow;
  }

  getByCompositeKey(node_id: string, run_id: string): SwarmClaimRow | null {
    const row = this.db
      .prepare(`SELECT * FROM swarm_claims WHERE node_id = ? AND run_id = ?`)
      .get(node_id, run_id) as SwarmClaimRow | undefined;
    return row ?? null;
  }

  /**
   * Best-effort lookup by merkle_root. The verify route uses this to
   * locate a claim from a user-supplied root. Returns the most
   * recently submitted matching row (collisions are theoretically
   * possible but in practice each browser run produces a unique
   * merkle_root because the master_seed + bot_count differs).
   */
  getByMerkleRoot(merkle_root: string): SwarmClaimRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM swarm_claims
           WHERE merkle_root = ?
           ORDER BY submitted_at DESC
           LIMIT 1`,
      )
      .get(merkle_root) as SwarmClaimRow | undefined;
    return row ?? null;
  }

  /**
   * Cross-swarm leaderboard. Sorted by claimed_score desc, then by
   * submitted_at asc as a tiebreaker so a first-submitter beats a
   * later identical claim.
   *
   * `proof_url_builder` lets the caller plug in its absolute URL
   * prefix so the rendered URLs work both behind the dev port and on
   * play.tournamental.com.
   */
  leaderboard(
    limit: number,
    proof_url_builder: (merkle_root: string) => string,
  ): LeaderboardRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM swarm_claims
           ORDER BY claimed_score DESC, submitted_at ASC
           LIMIT ?`,
      )
      .all(limit) as SwarmClaimRow[];
    return rows.map((r, i): LeaderboardRow => {
      let claim: TopNClaim;
      try {
        claim = JSON.parse(r.top_n_claim_json) as TopNClaim;
      } catch {
        claim = { bot_index: 0, claimed_score: r.claimed_score, picks_count: 0 };
      }
      const bitcoinConfirmed = r.ots_status === "confirmed";
      return {
        rank: i + 1,
        node_id_short: r.node_id.slice(0, 14),
        bot_index: claim.bot_index,
        claimed_score: r.claimed_score,
        merkle_root: r.merkle_root,
        ots_proof_url: proof_url_builder(r.merkle_root),
        bitcoin_confirmed: bitcoinConfirmed,
        submitted_at: r.submitted_at,
      };
    });
  }

  /**
   * Aggregate totals across every swarm-claim row. Drives the
   * `/v1/swarm/totals` endpoint that the /bot-arena marketing page
   * polls (60s cache server-side, so cheap to call). Returns:
   *   total_bots      sum of `total_bots` across all rows
   *   total_swarms    number of distinct (node_id, run_id) rows
   *   total_devices   number of distinct node_ids
   *
   * The "still perfect" count is intentionally NOT aggregated here:
   * it depends on per-bot regeneration against settled match results,
   * which the client computes against its own IndexedDB (the
   * regenerate-on-demand contract documented in
   * docs/30-browser-swarm-architecture.md). The /bot-arena page only
   * surfaces the device-local perfect count for the current viewer.
   * Tim 2026-06-08.
   */
  totals(): {
    total_bots: number;
    total_swarms: number;
    total_devices: number;
  } {
    // Tim 2026-06-08: only count rows bound to a signed-in user. The
    // /v1/swarm/commit handler refuses anonymous submissions outright,
    // but the WHERE clause defends against legacy null-user rows that
    // pre-date migration 0016 (the migration also wipes them, so in
    // practice this should be a no-op filter).
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(total_bots), 0) AS total_bots,
                COUNT(*)                     AS total_swarms,
                COUNT(DISTINCT node_id)      AS total_devices
           FROM swarm_claims
          WHERE user_id IS NOT NULL`,
      )
      .get() as {
      total_bots: number;
      total_swarms: number;
      total_devices: number;
    };
    return {
      total_bots: Number(row.total_bots) || 0,
      total_swarms: Number(row.total_swarms) || 0,
      total_devices: Number(row.total_devices) || 0,
    };
  }

  /**
   * Roll-up of every claim still waiting on a Bitcoin attestation.
   * The scheduler scans this list every poll cycle and tries to
   * upgrade each one. Returns rows that haven't been polled in the
   * last `staleness_ms` window so we don't hammer the calendars.
   */
  pendingToUpgrade(args: {
    staleness_ms: number;
    limit?: number;
    now?: number;
  }): SwarmClaimRow[] {
    const now = args.now ?? Date.now();
    const cutoff = now - args.staleness_ms;
    const limit = args.limit ?? 100;
    return this.db
      .prepare(
        `SELECT * FROM swarm_claims
           WHERE ots_status = 'pending'
             AND (last_upgrade_attempt_at IS NULL
                  OR last_upgrade_attempt_at < ?)
           ORDER BY submitted_at ASC
           LIMIT ?`,
      )
      .all(cutoff, limit) as SwarmClaimRow[];
  }

  recordUpgradeAttempt(args: {
    node_id: string;
    run_id: string;
    now?: number;
  }): void {
    const now = args.now ?? Date.now();
    this.db
      .prepare(
        `UPDATE swarm_claims
            SET last_upgrade_attempt_at = ?
          WHERE node_id = ? AND run_id = ?`,
      )
      .run(now, args.node_id, args.run_id);
  }

  recordUpgradeSuccess(args: {
    node_id: string;
    run_id: string;
    calendar_url: string;
    upgraded_ots_hex: string;
    now?: number;
  }): void {
    const now = args.now ?? Date.now();
    this.db
      .prepare(
        `UPDATE swarm_claims
            SET ots_status            = 'confirmed',
                upgraded_calendar_url = ?,
                upgraded_ots_hex      = ?,
                upgraded_at           = ?,
                last_upgrade_attempt_at = ?
          WHERE node_id = ? AND run_id = ?`,
      )
      .run(
        args.calendar_url,
        args.upgraded_ots_hex,
        now,
        now,
        args.node_id,
        args.run_id,
      );
  }

  /** Parsed accessor used by the proof route. */
  parsePending(row: SwarmClaimRow): PendingCalendarBlob[] {
    try {
      const parsed = JSON.parse(row.pending_calendar_blobs);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (x): x is PendingCalendarBlob =>
          x &&
          typeof x === "object" &&
          typeof (x as PendingCalendarBlob).calendar_url === "string" &&
          typeof (x as PendingCalendarBlob).pending_bytes_hex === "string",
      );
    } catch {
      return [];
    }
  }

  parseTopClaim(row: SwarmClaimRow): TopNClaim {
    try {
      const parsed = JSON.parse(row.top_n_claim_json) as TopNClaim;
      return parsed;
    } catch {
      return { bot_index: 0, claimed_score: row.claimed_score, picks_count: 0 };
    }
  }
}
