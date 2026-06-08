/**
 * Run N bots in parallel with bounded concurrency.
 *
 * Each worker pops a bot id off the queue, lets the caller add picks via
 * the per-bot `Bot` instance, then flushes. Default concurrency is 16,
 * which is a good fit for the bulk-insert endpoint's 60 req/min budget
 * (spec §6.4). For very large swarms (10k+), prefer one BulkSubmission
 * with many `submissions[]` entries; see examples/04-swarm.ts.
 */

import { Bot } from "./bot.js";
import type { ClientOpts } from "./client.js";

export interface SwarmOpts extends ClientOpts {
  /** Identifiers for the bots this swarm will drive. */
  botIds: string[];
  tournamentId?: string;
  /** Maximum number of in-flight bots. Default 16. */
  concurrency?: number;
}

export interface SwarmStats {
  bots: number;
  ok: number;
  failed: number;
}

export class Swarm {
  private readonly opts: SwarmOpts;

  constructor(opts: SwarmOpts) {
    if (!Array.isArray(opts.botIds) || opts.botIds.length === 0) {
      throw new Error("bot-sdk: Swarm requires at least one botId");
    }
    this.opts = opts;
  }

  /** The configured concurrency limit. */
  get concurrency(): number {
    return this.opts.concurrency ?? 16;
  }

  /** Snapshot of the bot ids this swarm will drive. */
  get botIds(): readonly string[] {
    return this.opts.botIds;
  }

  /**
   * Run `fn` once per bot, then flush each bot. Errors thrown by `fn` or
   * `flush()` count as failures and do not stop the swarm. Stats are
   * returned so the caller can decide whether to retry.
   */
  async eachBot(fn: (bot: Bot) => Promise<void>): Promise<SwarmStats> {
    const queue = this.opts.botIds.slice();
    const stats: SwarmStats = { bots: queue.length, ok: 0, failed: 0 };
    const workerCount = Math.min(this.concurrency, queue.length);
    const workers = Array.from({ length: workerCount }, () =>
      this.worker(queue, fn, stats),
    );
    await Promise.all(workers);
    return stats;
  }

  private async worker(
    queue: string[],
    fn: (bot: Bot) => Promise<void>,
    stats: SwarmStats,
  ): Promise<void> {
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) return;
      const bot = new Bot({ ...this.opts, botId: id });
      try {
        await fn(bot);
        await bot.flush();
        stats.ok += 1;
      } catch (_err) {
        stats.failed += 1;
      }
    }
  }
}
