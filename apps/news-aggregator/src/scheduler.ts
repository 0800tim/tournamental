/**
 * Periodic refresh loop.
 *
 * Pulls every enabled source on `intervalMs` cadence, writes results
 * into the store, and is robust against overlapping triggers — if a
 * fetch is still in flight when the next tick fires, we skip the new
 * tick rather than firing two concurrent passes.
 */
import type { FastifyBaseLogger } from 'fastify';

import type { SourceFetcher } from './lib/fetcher.js';
import type { NewsStore } from './lib/store.js';
import { enabledSources } from './sources/index.js';

export interface SchedulerOptions {
  readonly intervalMs: number;
  readonly fetcher: SourceFetcher;
  readonly store: NewsStore;
  readonly logger: FastifyBaseLogger;
}

export class Scheduler {
  private readonly opts: SchedulerOptions;
  private timer: NodeJS.Timeout | null = null;
  private inflight = false;
  private lastRunAt: string | null = null;

  constructor(opts: SchedulerOptions) {
    this.opts = opts;
  }

  start(): void {
    if (this.timer) return;
    // First tick fires immediately so users see content on boot,
    // subsequent ticks at the interval.
    this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.opts.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getLastRunAt(): string | null {
    return this.lastRunAt;
  }

  async tick(): Promise<{ added: number; sources: number }> {
    if (this.inflight) {
      this.opts.logger.debug('news scheduler: skip tick — previous run still in flight');
      return { added: 0, sources: 0 };
    }
    this.inflight = true;
    const started = Date.now();
    try {
      const sources = enabledSources();
      const results = await this.opts.fetcher.fetchAll(sources);
      const flat = results.flatMap((r) => r.items);
      const added = await this.opts.store.insertMany(flat);
      this.lastRunAt = new Date().toISOString();
      const errors = results.filter((r) => !r.ok);
      this.opts.logger.info(
        {
          durationMs: Date.now() - started,
          sourcesPolled: sources.length,
          added,
          totalItems: this.opts.store.size(),
          errors: errors.map((e) => ({ source: e.source, error: e.error })),
        },
        'news scheduler tick',
      );
      return { added, sources: sources.length };
    } catch (err) {
      this.opts.logger.error({ err }, 'news scheduler tick failed');
      return { added: 0, sources: 0 };
    } finally {
      this.inflight = false;
    }
  }
}
