import type { CentralClient } from "./central.js";
import { merkleRoot } from "./merkle.js";
import type { Storage } from "./storage.js";
import type { CommitLogRow, MatchSpec } from "./types.js";

export interface CommitMatchOptions {
  storage: Storage;
  match: MatchSpec;
  /** If true, do not call the central server. */
  dry_run?: boolean;
  /** Override clock for tests. */
  now?: () => number;
  /** Override central client; if omitted, dry_run must be true. */
  central?: CentralClient;
  /** Override node_id when invoking central in non-dry-run mode. */
  node_id?: string;
}

export interface CommitResult {
  match_id: string;
  merkle_root: string;
  bot_count: number;
  kickoff_at_utc: number;
  committed_at_utc: number;
  pushed_to_central: boolean;
  central_ack_at_utc: number | null;
}

/**
 * Build a leaf for one pick. The shape matches what the central server uses
 * so the federated leaderboard can merge without re-hashing. We include
 * `chalk_score` (rounded to 4dp) so audits can replay deterministically.
 */
export function pickLeaf(
  bot_id: string,
  match_id: string,
  outcome: string,
  chalk_score: number,
  locked_at_utc: number,
): string {
  const cs = chalk_score.toFixed(4);
  return [bot_id, match_id, outcome, cs, locked_at_utc].join("|");
}

export async function commitMatch(opts: CommitMatchOptions): Promise<CommitResult> {
  const now = opts.now ?? Date.now;
  const kickoff = Date.parse(opts.match.kickoff_utc);
  if (Number.isNaN(kickoff)) {
    throw new Error(`invalid kickoff_utc on match ${opts.match.match_id}`);
  }
  const committed_at_utc = now();
  if (committed_at_utc > kickoff) {
    throw new Error(
      `commit for ${opts.match.match_id} would be after kickoff (${kickoff}); ` +
        `the central server will reject this`,
    );
  }

  const picks = opts.storage.listPicksForMatch(opts.match.match_id);
  const leaves = picks.map((p) =>
    pickLeaf(p.bot_id, p.match_id, p.outcome, p.chalk_score, p.locked_at_utc),
  );
  const root = merkleRoot(leaves);

  const row: CommitLogRow = {
    match_id: opts.match.match_id,
    merkle_root: root,
    bot_count: picks.length,
    kickoff_at_utc: kickoff,
    committed_at_utc,
    central_ack_at_utc: null,
  };

  let pushed = false;
  let ack: number | null = null;
  if (!opts.dry_run) {
    if (!opts.central) throw new Error("non-dry-run commit requires central client");
    if (!opts.node_id) throw new Error("non-dry-run commit requires node_id");
    const res = await opts.central.commit({
      node_id: opts.node_id,
      match_id: opts.match.match_id,
      merkle_root: root,
      bot_count: picks.length,
      kickoff_at: kickoff,
    });
    pushed = true;
    ack = res.central_received_at;
    row.central_ack_at_utc = ack;
  }

  opts.storage.insertCommitLog(row);
  opts.storage.markPicksCommitted(opts.match.match_id, committed_at_utc);

  return {
    match_id: opts.match.match_id,
    merkle_root: root,
    bot_count: picks.length,
    kickoff_at_utc: kickoff,
    committed_at_utc,
    pushed_to_central: pushed,
    central_ack_at_utc: ack,
  };
}

export interface PendingMatch {
  match: MatchSpec;
  reason: "upcoming" | "missed";
}

/**
 * List matches whose merkle root has not yet been committed, partitioned by
 * whether they kickoff in the future (eligible) or already passed (missed).
 */
export function pendingMatches(
  matches: MatchSpec[],
  storage: Storage,
  now: number = Date.now(),
): PendingMatch[] {
  const result: PendingMatch[] = [];
  const committed = new Set(
    storage.db
      .prepare<[], { match_id: string }>("SELECT match_id FROM commit_log")
      .all()
      .map((r) => r.match_id),
  );
  for (const match of matches) {
    if (committed.has(match.match_id)) continue;
    const k = Date.parse(match.kickoff_utc);
    if (Number.isNaN(k)) continue;
    result.push({
      match,
      reason: k > now ? "upcoming" : "missed",
    });
  }
  return result;
}
