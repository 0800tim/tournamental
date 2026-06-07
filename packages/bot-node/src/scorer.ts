import type { CentralClient } from "./central.js";
import type { Storage } from "./storage.js";
import type { LeaderboardPayload, MatchResult, Outcome } from "./types.js";

export interface ScoreMatchOptions {
  storage: Storage;
  result: MatchResult;
  /** If true, do not push the leaderboard aggregate to central. */
  dry_run?: boolean;
  /** Override clock for tests. */
  now?: () => number;
  central?: CentralClient;
  node_id?: string;
  /** Max entries to ship in `top_1000`. Defaults to 1000. */
  top_n?: number;
}

export interface ScoreMatchSummary {
  match_id: string;
  outcome: Outcome;
  total_bots: number;
  bots_correct: number;
  bots_still_perfect: number;
  top_n: number;
  pushed_to_central: boolean;
  central_ack_at_utc: number | null;
  elapsed_ms: number;
}

export async function scoreMatch(opts: ScoreMatchOptions): Promise<ScoreMatchSummary> {
  const start = (opts.now ?? Date.now)();
  const resolvedAt = Date.parse(opts.result.resolved_at_utc);
  if (Number.isNaN(resolvedAt)) {
    throw new Error(`invalid resolved_at_utc on ${opts.result.match_id}`);
  }
  opts.storage.recordResult(opts.result.match_id, opts.result.outcome, resolvedAt);

  const correct = opts.storage.scoreMatch(
    opts.result.match_id,
    opts.result.outcome,
    start,
  );
  const totalBots = opts.storage.countBots();
  const stillPerfect = opts.storage.countBotsStillPerfect();
  const topN = opts.top_n ?? 1000;
  const top = opts.storage.topBots(opts.result.match_id, topN);

  let pushed = false;
  let ack: number | null = null;
  if (!opts.dry_run) {
    if (!opts.central) throw new Error("non-dry-run score requires central client");
    if (!opts.node_id) throw new Error("non-dry-run score requires node_id");
    const payload: LeaderboardPayload = {
      node_id: opts.node_id,
      match_id: opts.result.match_id,
      total_bots: totalBots,
      bots_correct: correct,
      bots_still_perfect: stillPerfect,
      top_1000: top.map((t) => ({
        bot_id: t.bot_id,
        correct_picks: t.correct_picks,
        still_perfect: t.still_perfect,
      })),
    };
    const res = await opts.central.reportLeaderboard(payload);
    pushed = true;
    ack = res.central_received_at;
  }

  return {
    match_id: opts.result.match_id,
    outcome: opts.result.outcome,
    total_bots: totalBots,
    bots_correct: correct,
    bots_still_perfect: stillPerfect,
    top_n: top.length,
    pushed_to_central: pushed,
    central_ack_at_utc: ack,
    elapsed_ms: Date.now() - start,
  };
}
