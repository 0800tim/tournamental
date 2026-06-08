/**
 * Kickoff commitment service , Phase 2 forward-compat per spec §15.6.
 *
 * What it does:
 *   1. Reads every bracket that has a pick for the kickoff's match_id.
 *   2. Builds a merkle tree over (user_id, match_id, outcome, locked_at)
 *      leaves using the sorted-pair sha256 helper in apps/game/src/lib/merkle.ts.
 *   3. Calls the supplied `postOts(root)` hook (today this is wired to
 *      apps/vstamp; tomorrow it broadcasts to a Bitcoin tx via the OTS
 *      protocol). The Phase 2 federated tree adds federated leaves to
 *      the same shape, so adopting nodes is a matter of expanding the
 *      input set rather than refactoring the verifier.
 *   4. Stamps every contributing bracket row with `committed_at_utc`
 *      so a post-hoc audit can reconstruct which kickoff anchored
 *      which pick.
 *
 * Why this lives next to apps/vstamp's own merkle helper rather than
 * calling it: vstamp builds RFC 6962 (left/right-positioned) trees for
 * its receipt format. The Phase 2 audit per §15.6 needs the simpler
 * sorted-pair shape that any node operator can verify in 50 lines of
 * code. Two trees, two purposes, no coupling.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §15.6
 */
import type { GameStore } from "../store/db.js";
import { buildMerkle, type PickLeaf, type Outcome } from "../lib/merkle.js";

export interface CommitKickoffOpts {
  store: GameStore;
  tournament_id: string;
  match_id: string;
  /** epoch ms stamped onto every contributing bracket as committed_at_utc */
  committed_at_utc: number;
  /**
   * Async hook that posts the merkle root to the OTS layer (today
   * apps/vstamp's POST /v1/vstamp/anchor, tomorrow a Bitcoin tx). The
   * hook receives the hex-encoded 64-char root.
   */
  postOts: (root: string) => Promise<void>;
}

export interface CommitKickoffResult {
  root: string;
  leaf_count: number;
}

interface BracketRowWithPayload {
  id: string;
  user_id: string;
  payload_json: string;
  locked_at: number;
}

interface PickRecord {
  matchId?: string;
  outcome?: Outcome | string;
  lockedAt?: string;
}

function isOutcome(s: unknown): s is Outcome {
  return s === "home_win" || s === "draw" || s === "away_win";
}

/**
 * Build a kickoff commitment for one (tournament, match) pair. Reads
 * are SELECT-only; the only write is the committed_at_utc stamp on
 * each contributing bracket. The DB read and the stamp run inside one
 * transaction so a concurrent re-score does not observe a
 * half-committed state.
 */
export async function commitKickoff(
  opts: CommitKickoffOpts,
): Promise<CommitKickoffResult> {
  // Pull every bracket for this tournament; in production the worst
  // case is ~80k rows pre-kickoff and SQLite can stream them under
  // 50ms. We filter in Node because the picks are JSON inside
  // payload_json, not a separate column.
  const rows = opts.store.db
    .prepare(
      `SELECT id, user_id, payload_json, locked_at
         FROM brackets
        WHERE tournament_id = ?`,
    )
    .all(opts.tournament_id) as BracketRowWithPayload[];

  const leaves: PickLeaf[] = [];
  const includedBracketIds: string[] = [];
  for (const r of rows) {
    let parsed: {
      matchPredictions?: Record<string, PickRecord>;
      knockoutPredictions?: Record<string, PickRecord>;
    };
    try {
      parsed = JSON.parse(r.payload_json) as typeof parsed;
    } catch {
      continue;
    }
    const pick =
      parsed.matchPredictions?.[opts.match_id] ??
      parsed.knockoutPredictions?.[opts.match_id];
    if (!pick) continue;
    if (!isOutcome(pick.outcome)) continue;
    leaves.push({
      bot_id: r.user_id,
      match_id: opts.match_id,
      outcome: pick.outcome,
      t: r.locked_at,
    });
    includedBracketIds.push(r.id);
  }

  const tree = buildMerkle(leaves);
  await opts.postOts(tree.root);

  if (includedBracketIds.length > 0) {
    const stampStmt = opts.store.db.prepare(
      `UPDATE brackets SET committed_at_utc = ? WHERE id = ?`,
    );
    const txn = opts.store.db.transaction((ids: readonly string[]) => {
      for (const id of ids) stampStmt.run(opts.committed_at_utc, id);
    });
    txn(includedBracketIds);
  }

  return { root: tree.root, leaf_count: leaves.length };
}
