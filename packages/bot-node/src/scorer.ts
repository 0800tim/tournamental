import type { CentralClient } from "./central.js";
import { regenerateBotPickForMatch } from "./generator.js";
import type { Storage } from "./storage.js";
import { chalkStrategy } from "./strategy/chalk.js";
import type { Strategy } from "./strategy/index.js";
import type {
  LeaderboardEntry,
  LeaderboardPayload,
  MatchResult,
  MatchSpec,
  Outcome,
} from "./types.js";

export interface ScoreMatchOptions {
  storage: Storage;
  result: MatchResult;
  /**
   * Match catalogue. Needed because the scorer no longer reads
   * `bot_pick` from SQLite; it regenerates each bot's pick on
   * demand from (run_seed, bot_index, strategy, MatchSpec).
   */
  matches: MatchSpec[];
  /** Strategy lookup keyed by strategy name. Defaults to a single
   *  entry of `{ "chalk-v1": chalkStrategy }`. The scorer needs the
   *  same strategy the generator used per swarm. */
  strategies?: Record<string, Strategy>;
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

/**
 * Score a settled match across every bot in every swarm.
 *
 * v0.3.0 (Tim 2026-06-08): regenerate-on-demand.
 *
 * The v0.2.0 scorer read picks from the `bot_pick` table; v0.3.0
 * regenerates each pick from (run_seed, bot_index, strategy) and
 * the MatchSpec, because the picks are no longer stored. Cost:
 * ~3 micro-seconds per (bot, match) regeneration. A million-bot
 * swarm scores a single match in ~3 seconds single-threaded.
 *
 * "Still perfect" means a bot picked the actual outcome on every
 * settled match. We compute it by replaying every settled match
 * through the regenerator for each candidate bot. Worst-case for
 * the 2026 WC (1B bots, 104 settled matches) is ~3 trillion ops --
 * the dashboard distributes scoring across workers to absorb this.
 */
export async function scoreMatch(opts: ScoreMatchOptions): Promise<ScoreMatchSummary> {
  const start = (opts.now ?? Date.now)();
  const resolvedAt = Date.parse(opts.result.resolved_at_utc);
  if (Number.isNaN(resolvedAt)) {
    throw new Error(`invalid resolved_at_utc on ${opts.result.match_id}`);
  }
  opts.storage.recordResult(opts.result.match_id, opts.result.outcome, resolvedAt);

  const match = opts.matches.find((m) => m.match_id === opts.result.match_id);
  if (!match) {
    throw new Error(
      `match catalogue missing entry for settled match_id=${opts.result.match_id}`,
    );
  }
  const strategies: Record<string, Strategy> =
    opts.strategies ?? { [chalkStrategy.name]: chalkStrategy };

  const swarms = opts.storage.listSwarmRuns();
  const settled = opts.storage.listSettledMatches();
  const settledById = new Map<string, Outcome>();
  for (const s of settled) settledById.set(s.match_id, s.outcome);
  // Ensure this match is treated as settled even if the row race
  // with the upsert above leaves it out of listSettledMatches().
  settledById.set(opts.result.match_id, opts.result.outcome);

  const matchById = new Map<string, MatchSpec>();
  for (const m of opts.matches) matchById.set(m.match_id, m);

  let totalBotsAllSwarms = 0;
  let totalCorrectAllSwarms = 0;
  let totalStillPerfectAllSwarms = 0;

  const topN = opts.top_n ?? 1000;
  const topPool: LeaderboardEntry[] = [];

  // Single pass per bot: regenerate every settled match's pick once
  // and decide both "this match correct?" and "still perfect across
  // all settled?". O(bots * settled_matches) regenerations.
  for (const swarm of swarms) {
    const strat = strategies[swarm.strategy];
    if (!strat) {
      // Strategy not registered with this scorer; count bots but
      // record 0 correct/perfect so the operator notices.
      totalBotsAllSwarms += swarm.total_bots;
      opts.storage.upsertMatchScoreSummary({
        match_id: opts.result.match_id,
        run_seed: swarm.run_seed,
        strategy: swarm.strategy,
        bots_correct: 0,
        bots_still_perfect: 0,
        total_bots_at_score: swarm.total_bots,
        scored_at_utc: start,
      });
      continue;
    }

    let swarmCorrect = 0;
    let swarmPerfect = 0;
    for (let i = 0; i < swarm.total_bots; i++) {
      let cumulativeCorrect = 0;
      let stillPerfect = true;
      let pickedThisMatch: Outcome | null = null;
      for (const [mid, actual] of settledById.entries()) {
        const m = matchById.get(mid);
        if (!m) continue;
        const { outcome } = regenerateBotPickForMatch(swarm.run_seed, i, strat, m);
        if (outcome === actual) cumulativeCorrect++;
        else stillPerfect = false;
        if (mid === opts.result.match_id) pickedThisMatch = outcome;
      }
      if (pickedThisMatch === opts.result.outcome) {
        swarmCorrect++;
        totalCorrectAllSwarms++;
      }
      if (stillPerfect && settledById.size > 0) {
        swarmPerfect++;
        totalStillPerfectAllSwarms++;
      }

      // Bounded top-N pool. Sort + truncate when 4x the cap to
      // avoid an external heap dep.
      topPool.push({
        bot_id: `bn_${swarm.run_seed.slice(0, 8)}_${i.toString(36)}`,
        correct_picks: cumulativeCorrect,
        still_perfect: stillPerfect,
      });
      if (topPool.length > topN * 4) {
        topPool.sort((a, b) => b.correct_picks - a.correct_picks);
        topPool.length = topN;
      }
    }

    totalBotsAllSwarms += swarm.total_bots;
    opts.storage.upsertMatchScoreSummary({
      match_id: opts.result.match_id,
      run_seed: swarm.run_seed,
      strategy: swarm.strategy,
      bots_correct: swarmCorrect,
      bots_still_perfect: swarmPerfect,
      total_bots_at_score: swarm.total_bots,
      scored_at_utc: start,
    });
  }

  topPool.sort((a, b) => b.correct_picks - a.correct_picks);
  const top = topPool.slice(0, topN);

  opts.storage.markMatchScored(opts.result.match_id, start);

  let pushed = false;
  let ack: number | null = null;
  if (!opts.dry_run) {
    if (!opts.central) throw new Error("non-dry-run score requires central client");
    if (!opts.node_id) throw new Error("non-dry-run score requires node_id");
    const payload: LeaderboardPayload = {
      node_id: opts.node_id,
      match_id: opts.result.match_id,
      total_bots: totalBotsAllSwarms,
      bots_correct: totalCorrectAllSwarms,
      bots_still_perfect: totalStillPerfectAllSwarms,
      top_1000: top,
    };
    const res = await opts.central.reportLeaderboard(payload);
    pushed = true;
    ack = res.central_received_at;
  }

  return {
    match_id: opts.result.match_id,
    outcome: opts.result.outcome,
    total_bots: totalBotsAllSwarms,
    bots_correct: totalCorrectAllSwarms,
    bots_still_perfect: totalStillPerfectAllSwarms,
    top_n: top.length,
    pushed_to_central: pushed,
    central_ack_at_utc: ack,
    elapsed_ms: Date.now() - start,
  };
}
