import type { CentralClient } from "./central.js";
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
  /** When multiple swarms share this node, each gets its own commit;
   *  this lists what was posted. The top-level fields reflect the
   *  primary (largest) swarm so single-swarm callers see the same
   *  shape as before. */
  per_swarm_commits?: ReadonlyArray<{
    run_seed: string;
    strategy: string;
    merkle_root: string;
    bot_count: number;
  }>;
}

/**
 * Commit the merkle root for a single match across every swarm in
 * this node's storage.
 *
 * v0.3.0 (Tim 2026-06-08): regenerate-on-demand.
 *
 * The v0.2.0 scheduler read every `bot_pick` row for the match,
 * built a leaf per pick, and merkle-hashed the lot at commit time
 * -- so committing a million-bot swarm involved scanning a 16 GB
 * SQLite table. v0.3.0 reads the per-match root directly from the
 * `swarm_run.per_match_roots_json` field that the generator wrote
 * eagerly at generation time. The commit becomes O(1) per match,
 * regardless of bot count.
 *
 * Each swarm posts its own commit (composite key on central is
 * (node_id, run_id), so they don't collide). The dashboard's
 * single-swarm flow sees the same CommitResult shape as v0.2.0.
 */
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

  const swarms = opts.storage.listSwarmRuns();
  if (swarms.length === 0) {
    throw new Error(
      `no swarms in storage to commit; run \`tournamental-bot-node generate\` first`,
    );
  }

  // Sort by total_bots desc so the primary commit (the one whose
  // numbers go on top of CommitResult) is the largest swarm.
  const sorted = [...swarms].sort((a, b) => b.total_bots - a.total_bots);

  const perSwarmCommits: Array<{
    run_seed: string;
    strategy: string;
    merkle_root: string;
    bot_count: number;
  }> = [];

  let primaryRoot = "";
  let primaryBotCount = 0;
  let pushed = false;
  let firstAck: number | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const swarm = sorted[i]!;
    const root = swarm.per_match_roots[opts.match.match_id];
    if (!root) {
      // Swarm has no leaves for this match (unknown match in
      // catalogue at generation time). Skip cleanly.
      continue;
    }
    if (i === 0) {
      primaryRoot = root;
      primaryBotCount = swarm.total_bots;
    }

    perSwarmCommits.push({
      run_seed: swarm.run_seed,
      strategy: swarm.strategy,
      merkle_root: root,
      bot_count: swarm.total_bots,
    });

    if (!opts.dry_run) {
      if (!opts.central) throw new Error("non-dry-run commit requires central client");
      if (!opts.node_id) throw new Error("non-dry-run commit requires node_id");
      const res = await opts.central.commit({
        node_id: opts.node_id,
        match_id: opts.match.match_id,
        merkle_root: root,
        bot_count: swarm.total_bots,
        kickoff_at: kickoff,
      });
      pushed = true;
      if (firstAck == null) firstAck = res.central_received_at;
    }
  }

  if (perSwarmCommits.length === 0) {
    throw new Error(
      `no swarm in storage has a merkle root for match ${opts.match.match_id}; ` +
        `re-run generate against this match catalogue`,
    );
  }

  const row: CommitLogRow = {
    match_id: opts.match.match_id,
    merkle_root: primaryRoot,
    bot_count: primaryBotCount,
    kickoff_at_utc: kickoff,
    committed_at_utc,
    central_ack_at_utc: firstAck,
  };
  opts.storage.insertCommitLog(row);

  return {
    match_id: opts.match.match_id,
    merkle_root: primaryRoot,
    bot_count: primaryBotCount,
    kickoff_at_utc: kickoff,
    committed_at_utc,
    pushed_to_central: pushed,
    central_ack_at_utc: firstAck,
    per_swarm_commits: perSwarmCommits,
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
