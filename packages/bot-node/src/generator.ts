import { createHash, randomBytes } from "node:crypto";

import type { Storage } from "./storage.js";
import { chalkStrategy, defaultChalkScore } from "./strategy/chalk.js";
import type { Strategy } from "./strategy/index.js";
import type { BotPick, BotRecord, MatchSpec } from "./types.js";

export interface GeneratorOptions {
  /** Number of bots to materialise. */
  count: number;
  /** Deterministic seed for the whole batch. */
  seed?: string;
  /** Strategy used to decide picks. Defaults to chalk-v1. */
  strategy?: Strategy;
  /** Batch size for SQLite inserts. */
  batchSize?: number;
  /** Optional progress callback fired every batch. */
  onProgress?: (done: number, total: number) => void;
  /** Override for the locked_at_utc stamp, defaults to Date.now(). */
  now?: () => number;
}

export interface GenerationResult {
  bots_inserted: number;
  picks_inserted: number;
  elapsed_ms: number;
}

/**
 * Generate `count` bots and lock in picks for the supplied match catalogue.
 *
 * Uses prepared statements and one transaction per batch so 1M bots fits
 * comfortably on a 32-core / 40GB box. Deterministic: the same seed produces
 * the same `(bot_id, match_id, outcome)` triples bit-for-bit.
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

  let botsInserted = 0;
  let picksInserted = 0;

  for (let cursor = 0; cursor < opts.count; cursor += batchSize) {
    const end = Math.min(cursor + batchSize, opts.count);
    const bots: BotRecord[] = [];
    const picks: BotPick[] = [];
    const created = now();

    for (let i = cursor; i < end; i++) {
      const botSeed = createHash("sha256")
        .update(`${seed}::${i}`)
        .digest("hex");
      const botId = `bn_${botSeed.slice(0, 16)}`;
      const chalk = defaultChalkScore(botSeed);

      bots.push({
        bot_id: botId,
        seed: botSeed,
        strategy: strategy.name,
        created_at: created,
      });

      for (const match of matches) {
        const decision = strategy.decide(match, {
          seed: botSeed,
          chalk_score: chalk,
        });
        picks.push({
          bot_id: botId,
          match_id: match.match_id,
          outcome: decision.outcome,
          chalk_score: chalk,
          locked_at_utc: created,
          committed_at_utc: null,
        });
      }
    }

    storage.insertBotsBulk(bots);
    storage.insertPicksBulk(picks);
    botsInserted += bots.length;
    picksInserted += picks.length;
    opts.onProgress?.(botsInserted, opts.count);
  }

  return {
    bots_inserted: botsInserted,
    picks_inserted: picksInserted,
    elapsed_ms: Date.now() - start,
  };
}
