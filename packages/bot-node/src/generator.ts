import { createHash, randomBytes } from "node:crypto";

import { hashLeaf, merkleRoot } from "./merkle.js";
import type { Storage } from "./storage.js";
import {
  chalkStrategy,
  defaultChalkScore,
  defaultDarlingTeam,
} from "./strategy/chalk.js";
import type { Strategy } from "./strategy/index.js";
import type { MatchSpec } from "./types.js";

export interface GeneratorOptions {
  /** Number of bots to materialise into the swarm. */
  count: number;
  /** Deterministic seed for the whole batch. Reused calls with the
   *  same seed accumulate into a single `swarm_run` row. */
  seed?: string;
  /** Strategy used to decide picks. Defaults to chalk-v1. */
  strategy?: Strategy;
  /** Batch size for memory bounding. The whole batch's leaves are
   *  held in RAM before being folded into per-match merkle roots. */
  batchSize?: number;
  /** Optional progress callback fired every batch. */
  onProgress?: (done: number, total: number) => void;
  /** Override for the locked_at_utc stamp, defaults to Date.now(). */
  now?: () => number;
}

export interface GenerationResult {
  /** How many new bots were added to the swarm by this call. */
  bots_generated: number;
  /** How many (bot, match) picks were derived. Equals
   *  bots_generated * matches.length; included for parity with the
   *  v0.2.0 GenerationResult so callers don't break. */
  picks_generated: number;
  /** Cumulative bot count for this (seed, strategy) swarm after the
   *  call. Iteration domain for the scorer. */
  total_bots_after: number;
  /** Per-match merkle roots for the swarm, including new bots
   *  folded into the existing roots. */
  per_match_roots: Record<string, string>;
  elapsed_ms: number;
}

/**
 * Generate `count` new bots and write a single swarm_run row.
 *
 * v0.3.0 (Tim 2026-06-08): regenerate-on-demand.
 *
 * The v0.2.0 generator INSERTed a `bot` row per bot and a `bot_pick`
 * row per (bot, match) -- 104,000,000 SQLite rows for a million-bot
 * swarm, ~16 GB on disk. The picks were never read by anyone except
 * the scorer, and every read could have been recomputed from
 * (run_seed, bot_index, strategy) in ~3 ms.
 *
 * v0.3.0 inverts the contract: it computes the merkle root over
 * compact `(bot_index, outcome)` leaves and writes ONE row per
 * swarm + ONE merkle root per match. The bots themselves live as
 * integers in `[0, total_bots)`; the picks are re-derived on demand
 * by `regenerateBotPickForMatch()` below (used by the scorer and
 * by anyone verifying the merkle commit).
 *
 * Deterministic: same (seed, count, matches, strategy) -> same
 * merkle roots, bit for bit.
 */
export function generateBots(
  storage: Storage,
  matches: MatchSpec[],
  opts: GeneratorOptions,
): GenerationResult {
  const start = Date.now();
  const strategy = opts.strategy ?? chalkStrategy;
  const batchSize = opts.batchSize ?? 5_000;
  const now = opts.now ?? Date.now;
  const seed = opts.seed ?? randomBytes(16).toString("hex");

  const existing = storage.getSwarmRun(seed, strategy.name);
  const startIndex = existing?.total_bots ?? 0;
  const endIndex = startIndex + opts.count;

  // For the common case (no existing swarm under this seed), we
  // accumulate leaves per match as we go and merkle once at the end.
  // For the rarer case (resuming an existing seed), we recompute
  // from index 0 so the root spans the cumulative swarm.
  const needFullRecompute = !!existing && existing.total_bots > 0;
  const leavesByMatch = new Map<string, string[]>();
  if (!needFullRecompute) {
    for (const m of matches) leavesByMatch.set(m.match_id, []);
  }

  let botsGenerated = 0;
  let picksGenerated = 0;

  for (let cursor = startIndex; cursor < endIndex; cursor += batchSize) {
    const stop = Math.min(cursor + batchSize, endIndex);

    for (let i = cursor; i < stop; i++) {
      const botSeed = createHash("sha256")
        .update(`${seed}::${i}`)
        .digest("hex");
      const chalk = defaultChalkScore(botSeed);
      const darling = defaultDarlingTeam(botSeed) ?? undefined;
      const compactIdx = i.toString(36);

      for (const match of matches) {
        const decision = strategy.decide(match, {
          seed: botSeed,
          chalk_score: chalk,
          darling_team: darling,
        });
        const code =
          decision.outcome === "home_win"
            ? "h"
            : decision.outcome === "draw"
              ? "d"
              : "a";
        if (!needFullRecompute) {
          leavesByMatch.get(match.match_id)!.push(compactIdx + code);
        }
        picksGenerated++;
      }
      botsGenerated++;
    }

    opts.onProgress?.(cursor + (stop - cursor) - startIndex, opts.count);
  }

  const perMatchRoots: Record<string, string> = {};
  if (needFullRecompute) {
    // Recompute the full root including prior bots so the commit
    // is valid for the cumulative swarm.
    for (const m of matches) {
      const allLeaves: string[] = [];
      for (let i = 0; i < endIndex; i++) {
        const botSeed = createHash("sha256")
          .update(`${seed}::${i}`)
          .digest("hex");
        const chalk = defaultChalkScore(botSeed);
        const darling = defaultDarlingTeam(botSeed) ?? undefined;
        const decision = strategy.decide(m, {
          seed: botSeed,
          chalk_score: chalk,
          darling_team: darling,
        });
        const code =
          decision.outcome === "home_win"
            ? "h"
            : decision.outcome === "draw"
              ? "d"
              : "a";
        allLeaves.push(i.toString(36) + code);
      }
      perMatchRoots[m.match_id] = merkleRoot(allLeaves);
    }
  } else {
    for (const [matchId, leaves] of leavesByMatch.entries()) {
      perMatchRoots[matchId] = merkleRoot(leaves);
    }
  }

  const updated = storage.upsertSwarmRun({
    run_seed: seed,
    strategy: strategy.name,
    total_bots_added: botsGenerated,
    per_match_roots: perMatchRoots,
    now: now(),
  });

  return {
    bots_generated: botsGenerated,
    picks_generated: picksGenerated,
    total_bots_after: updated.total_bots,
    per_match_roots: updated.per_match_roots,
    elapsed_ms: Date.now() - start,
  };
}

/**
 * Recompute a single bot's pick for a single match without any
 * SQLite read. Used by the scorer to iterate `[0, total_bots)`
 * after a match result lands.
 */
export function regenerateBotPickForMatch(
  run_seed: string,
  bot_index: number,
  strategy: Strategy,
  match: MatchSpec,
): { outcome: "home_win" | "draw" | "away_win"; bot_seed: string; bot_id: string } {
  const botSeed = createHash("sha256")
    .update(`${run_seed}::${bot_index}`)
    .digest("hex");
  const chalk = defaultChalkScore(botSeed);
  const darling = defaultDarlingTeam(botSeed) ?? undefined;
  const decision = strategy.decide(match, {
    seed: botSeed,
    chalk_score: chalk,
    darling_team: darling,
  });
  return {
    outcome: decision.outcome,
    bot_seed: botSeed,
    bot_id: `bn_${botSeed.slice(0, 16)}`,
  };
}

/** Compact merkle-leaf format used by the generator + verifiers. */
export function leafForBotPick(
  bot_index: number,
  outcome: "home_win" | "draw" | "away_win",
): string {
  const code = outcome === "home_win" ? "h" : outcome === "draw" ? "d" : "a";
  return bot_index.toString(36) + code;
}

/** Compatibility re-export so callers can `import { hashLeaf } from "@tournamental/bot-node"`. */
export { hashLeaf };
