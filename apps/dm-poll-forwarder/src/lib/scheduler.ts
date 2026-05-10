/**
 * Per-channel polling scheduler.
 *
 * Each channel runs on its own interval. A channel's poll cycle is:
 *
 *   1. If paused, skip.
 *   2. If a poll is already in flight for this channel, skip (concurrency 1).
 *   3. Read previous cursor from store.
 *   4. Call poller.poll(prev).
 *   5. For each returned message: forward; abort the cycle on failure
 *      so we don't advance the cursor past an unforwarded message.
 *   6. Persist the new cursor.
 *
 * `runOnce(channel)` is exposed for tests and for the admin
 * `replay-failed` flow that wants to deterministically tick a channel.
 *
 * SIGTERM hooks the runtime side (see index.ts) — the scheduler exposes
 * `stop()` which cancels timers and waits for any in-flight cycle.
 */

import type { Channel, PollerStatus } from '../types.js';
import type { CursorStore } from './cursors.js';
import type { Forwarder } from './forwarder.js';
import type { Logger } from './log.js';
import type { Poller } from '../pollers/types.js';

export interface SchedulerEntry {
  poller: Poller;
  /** Poll interval in ms. */
  intervalMs: number;
  /** Optional flag to disable an entry without removing it. */
  enabled?: boolean;
}

export interface SchedulerOptions {
  entries: SchedulerEntry[];
  cursors: CursorStore;
  forwarder: Forwarder;
  log?: Logger;
  /** Override timer fns for tests. */
  timers?: {
    setInterval: typeof setInterval;
    clearInterval: typeof clearInterval;
  };
}

interface ChannelState {
  entry: SchedulerEntry;
  paused: boolean;
  inFlight: Promise<void> | null;
  timer: ReturnType<typeof setInterval> | null;
  lastPollAt: number | null;
  lastPollOk: boolean | null;
  lastPollMessages: number;
  lastError: string | null;
}

export class Scheduler {
  private readonly states = new Map<Channel, ChannelState>();
  private readonly cursors: CursorStore;
  private readonly forwarder: Forwarder;
  private readonly log: Logger;
  private readonly timers: {
    setInterval: typeof setInterval;
    clearInterval: typeof clearInterval;
  };
  private started = false;

  constructor(opts: SchedulerOptions) {
    this.cursors = opts.cursors;
    this.forwarder = opts.forwarder;
    this.log = opts.log ?? { info: () => {}, warn: () => {}, error: () => {} };
    this.timers = opts.timers ?? { setInterval, clearInterval };
    for (const e of opts.entries) {
      this.states.set(e.poller.channel, {
        entry: e,
        paused: false,
        inFlight: null,
        timer: null,
        lastPollAt: null,
        lastPollOk: null,
        lastPollMessages: 0,
        lastError: null,
      });
    }
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const [channel, st] of this.states) {
      if (st.entry.enabled === false) continue;
      st.timer = this.timers.setInterval(() => {
        void this.runOnce(channel);
      }, st.entry.intervalMs);
      // Allow process exit even if intervals are pending.
      (st.timer as unknown as { unref?: () => void }).unref?.();
    }
  }

  async stop(): Promise<void> {
    this.started = false;
    for (const st of this.states.values()) {
      if (st.timer) this.timers.clearInterval(st.timer);
      st.timer = null;
    }
    // Wait for any in-flight cycles.
    const pending: Array<Promise<void>> = [];
    for (const st of this.states.values()) if (st.inFlight) pending.push(st.inFlight);
    await Promise.allSettled(pending);
  }

  pause(channel: Channel): boolean {
    const st = this.states.get(channel);
    if (!st) return false;
    st.paused = true;
    return true;
  }

  resume(channel: Channel): boolean {
    const st = this.states.get(channel);
    if (!st) return false;
    st.paused = false;
    return true;
  }

  channels(): Channel[] {
    return [...this.states.keys()];
  }

  status(channel: Channel): PollerStatus | undefined {
    const st = this.states.get(channel);
    if (!st) return undefined;
    const cursor = this.cursors.get(channel) ?? null;
    return {
      channel,
      enabled: st.entry.enabled !== false,
      paused: st.paused,
      lastPollAt: st.lastPollAt,
      lastPollOk: st.lastPollOk,
      lastPollMessages: st.lastPollMessages,
      lastError: st.lastError,
      cursor,
      lagMs: st.lastPollAt ? Date.now() - st.lastPollAt : null,
    };
  }

  allStatus(): PollerStatus[] {
    return this.channels()
      .map((c) => this.status(c))
      .filter((s): s is PollerStatus => Boolean(s));
  }

  async runOnce(channel: Channel): Promise<void> {
    const st = this.states.get(channel);
    if (!st) return;
    if (st.paused) return;
    if (st.entry.enabled === false) return;
    if (st.inFlight) return; // Concurrency: one poll per channel at a time.
    const cycle = this.cycle(channel, st);
    st.inFlight = cycle;
    try {
      await cycle;
    } finally {
      st.inFlight = null;
    }
  }

  private async cycle(channel: Channel, st: ChannelState): Promise<void> {
    try {
      const prev = this.cursors.get(channel);
      const result = await st.entry.poller.poll(prev);
      let advancedTo = prev;
      for (const msg of result.messages) {
        const fwd = await this.forwarder.forward(msg);
        if (!fwd.ok) {
          // Stop advancing; next cycle will retry from the last good cursor.
          // The dead-letter queue (set up in the forwarder) preserves the
          // failed payload for replay-failed.
          st.lastPollOk = false;
          st.lastPollAt = Date.now();
          st.lastError = `forward-failed:${fwd.error ?? fwd.status}`;
          this.log.warn(
            { channel, externalId: msg.externalId, status: fwd.status, attempts: fwd.attempts },
            'forward failed; stopping cycle without advancing cursor',
          );
          if (advancedTo && advancedTo !== prev) {
            await this.cursors.set(channel, advancedTo);
          }
          return;
        }
        advancedTo = msg.cursor;
      }
      if (result.cursor && result.cursor !== prev) {
        await this.cursors.set(channel, result.cursor);
      } else if (advancedTo && advancedTo !== prev) {
        await this.cursors.set(channel, advancedTo);
      }
      st.lastPollOk = true;
      st.lastPollAt = Date.now();
      st.lastPollMessages = result.messages.length;
      st.lastError = null;
    } catch (err) {
      st.lastPollOk = false;
      st.lastPollAt = Date.now();
      st.lastError = (err as Error).message ?? String(err);
      this.log.error({ channel, err: st.lastError }, 'poll cycle threw');
    }
  }
}
