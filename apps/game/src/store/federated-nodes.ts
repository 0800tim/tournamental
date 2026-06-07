/**
 * Federated node DAO , Phase 2 forward-compat surface.
 *
 * Phase 2 (post-launch, in-tournament) onboards external operators who
 * run their own Tournamental Bot Node Docker image, hold their bots'
 * picks locally, and report commitments + post-match aggregates to the
 * central tier. This DAO is the central-side persistence for that
 * protocol so Phase 1 endpoints can already accept submissions; the
 * Phase 2 build then ships the node image + the on-chain verification
 * flow without changing the central schema again.
 *
 * Lifecycle:
 *   1. Operator hits /v1/nodes/register , one row in `federated_node`.
 *   2. Pre-kickoff, the node POSTs the merkle root of its bots' picks
 *      to /v1/nodes/commit , `commit()` here writes the merkle_root
 *      and bot_count to the (node_id, match_id) snapshot row.
 *   3. Post-match, the node POSTs aggregate scoring + top-K to
 *      /v1/nodes/leaderboard , `reportLeaderboard()` fills in
 *      bots_correct, bots_still_perfect, and top_json_blob.
 *
 * Trust model is captured in spec §15.3 / §15.4 , this file is just
 * the storage backbone.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §15.2
 */
import type { Database as DatabaseT } from "better-sqlite3";

export interface FederatedNodeRow {
  node_id: string;
  owner_email: string;
  owner_api_key_hash: string;
  public_url: string;
  label: string | null;
  registered_at: number;
  last_seen_at: number | null;
}

export interface FederatedSnapshotRow {
  node_id: string;
  match_id: string;
  merkle_root: string | null;
  kickoff_at: number | null;
  total_bots: number | null;
  bots_correct: number | null;
  bots_still_perfect: number | null;
  top_json_blob: string | null;
  submitted_at: number;
}

export interface RegisterParams {
  node_id: string;
  owner_email: string;
  owner_api_key_hash: string;
  public_url: string;
  label?: string | null;
  now?: number;
}

export interface CommitParams {
  node_id: string;
  match_id: string;
  merkle_root: string;
  kickoff_at: number;
  bot_count: number;
  now?: number;
}

export interface ReportLeaderboardParams {
  node_id: string;
  match_id: string;
  total_bots: number;
  bots_correct: number;
  bots_still_perfect: number;
  top: ReadonlyArray<unknown>;
  now?: number;
}

export class FederatedNodeStore {
  constructor(private readonly db: DatabaseT) {}

  register(p: RegisterParams): FederatedNodeRow {
    const now = p.now ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO federated_node
           (node_id, owner_email, owner_api_key_hash, public_url, label,
            registered_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        p.node_id,
        p.owner_email,
        p.owner_api_key_hash,
        p.public_url,
        p.label ?? null,
        now,
      );
    return this.getByNodeId(p.node_id) as FederatedNodeRow;
  }

  getByNodeId(node_id: string): FederatedNodeRow | null {
    const row = this.db
      .prepare(`SELECT * FROM federated_node WHERE node_id = ?`)
      .get(node_id) as FederatedNodeRow | undefined;
    return row ?? null;
  }

  getByApiKeyHash(api_key_hash: string): FederatedNodeRow[] {
    return this.db
      .prepare(
        `SELECT * FROM federated_node
           WHERE owner_api_key_hash = ?
           ORDER BY registered_at ASC`,
      )
      .all(api_key_hash) as FederatedNodeRow[];
  }

  touch(node_id: string, now: number = Date.now()): void {
    this.db
      .prepare(`UPDATE federated_node SET last_seen_at = ? WHERE node_id = ?`)
      .run(now, node_id);
  }

  /**
   * Persist the pre-kickoff merkle commitment. If the node has already
   * reported a leaderboard for this match (out-of-order delivery), the
   * commit row is upserted to add the merkle_root + bot_count without
   * clobbering the aggregate fields.
   */
  commit(p: CommitParams): void {
    const submitted_at = p.now ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO federated_leaderboard_snapshot
           (node_id, match_id, merkle_root, kickoff_at, total_bots,
            bots_correct, bots_still_perfect, top_json_blob,
            submitted_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?)
         ON CONFLICT(node_id, match_id) DO UPDATE
           SET merkle_root = excluded.merkle_root,
               kickoff_at  = excluded.kickoff_at,
               total_bots  = COALESCE(excluded.total_bots, total_bots),
               submitted_at = excluded.submitted_at`,
      )
      .run(
        p.node_id,
        p.match_id,
        p.merkle_root,
        p.kickoff_at,
        p.bot_count,
        submitted_at,
      );
  }

  /**
   * Persist the post-match aggregate report. Late-arriving commits
   * for the same (node_id, match_id) preserve the merkle_root if one
   * was already recorded.
   */
  reportLeaderboard(p: ReportLeaderboardParams): void {
    const submitted_at = p.now ?? Date.now();
    const top_blob = JSON.stringify(p.top ?? []);
    this.db
      .prepare(
        `INSERT INTO federated_leaderboard_snapshot
           (node_id, match_id, merkle_root, kickoff_at, total_bots,
            bots_correct, bots_still_perfect, top_json_blob,
            submitted_at)
         VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?)
         ON CONFLICT(node_id, match_id) DO UPDATE
           SET total_bots         = excluded.total_bots,
               bots_correct       = excluded.bots_correct,
               bots_still_perfect = excluded.bots_still_perfect,
               top_json_blob      = excluded.top_json_blob,
               submitted_at       = excluded.submitted_at`,
      )
      .run(
        p.node_id,
        p.match_id,
        p.total_bots,
        p.bots_correct,
        p.bots_still_perfect,
        top_blob,
        submitted_at,
      );
  }

  getSnapshot(node_id: string, match_id: string): FederatedSnapshotRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM federated_leaderboard_snapshot
           WHERE node_id = ? AND match_id = ?`,
      )
      .get(node_id, match_id) as FederatedSnapshotRow | undefined;
    return row ?? null;
  }

  listSnapshotsForMatch(match_id: string): FederatedSnapshotRow[] {
    return this.db
      .prepare(
        `SELECT * FROM federated_leaderboard_snapshot
           WHERE match_id = ?
           ORDER BY submitted_at ASC`,
      )
      .all(match_id) as FederatedSnapshotRow[];
  }

  /**
   * Aggregate all snapshots across all nodes into a single top-K list
   * ordered by per-row "score" descending. Used by GET
   * /v1/leaderboard?source=federated. The score key is whatever each
   * node emitted in its top_json_blob.
   */
  listFederatedTopK(limit: number = 100): Array<{
    node_id: string;
    match_id: string;
    row: unknown;
  }> {
    const rows = this.db
      .prepare(
        `SELECT node_id, match_id, top_json_blob
           FROM federated_leaderboard_snapshot
           WHERE top_json_blob IS NOT NULL`,
      )
      .all() as Array<{
      node_id: string;
      match_id: string;
      top_json_blob: string;
    }>;
    const out: Array<{ node_id: string; match_id: string; row: unknown }> = [];
    for (const r of rows) {
      let parsed: unknown[];
      try {
        parsed = JSON.parse(r.top_json_blob);
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      for (const row of parsed) {
        out.push({ node_id: r.node_id, match_id: r.match_id, row });
      }
    }
    return out.slice(0, limit);
  }
}
