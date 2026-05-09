import type { CommentaryLine } from "./templates.js";

export interface ScheduledLine extends CommentaryLine {
  /** Absolute t_ms in the match timeline when this line should start. */
  start_t_ms: number;
}

export interface SchedulerOptions {
  /**
   * Cooldown per channel after a line ends. Prevents talkover during
   * scrambles. Default 600ms.
   */
  channelCooldownMs?: number;
  /**
   * Hard cap on backlog per channel. Lines that miss the playable window
   * by more than this are dropped (rather than queued forever). Default 2.5s.
   */
  backlogDropMs?: number;
}

/**
 * Schedules commentary lines on three channels (play-by-play, colour,
 * structural) so the voice never talks over itself. Pure data + a `tick(t_ms)`
 * — the renderer drives playback by calling `tick()` once per frame and
 * playing whatever it returns.
 */
export class CommentaryScheduler {
  private channelCooldownMs: number;
  private backlogDropMs: number;

  /** Pending queue, sorted ascending by start_t_ms. */
  private queue: ScheduledLine[] = [];

  /** Per-channel "next free" t_ms — anything before this can't fire. */
  private nextFree: Record<string, number> = {
    "play-by-play": 0,
    colour: 0,
    structural: 0,
  };

  /** Set of line ids already scheduled — dedup retries on rebroadcast. */
  private known = new Set<string>();

  constructor(opts: SchedulerOptions = {}) {
    this.channelCooldownMs = opts.channelCooldownMs ?? 600;
    this.backlogDropMs = opts.backlogDropMs ?? 2500;
  }

  reset() {
    this.queue = [];
    this.known.clear();
    this.nextFree = { "play-by-play": 0, colour: 0, structural: 0 };
  }

  /**
   * Add lines produced by `generateCommentary`. `event_t_ms` is the source
   * event's timestamp; line offsets stack on top.
   */
  add(lines: CommentaryLine[], event_t_ms: number) {
    for (const line of lines) {
      if (this.known.has(line.id)) continue;
      this.known.add(line.id);
      this.queue.push({ ...line, start_t_ms: event_t_ms + line.offset_ms });
    }
    this.queue.sort((a, b) => a.start_t_ms - b.start_t_ms);
  }

  /**
   * Returns the line(s) that should fire AT OR BEFORE `t_ms` and whose
   * channel is free. Updates the channel "next free" times. Drops any lines
   * that have aged out of the backlog window.
   */
  tick(t_ms: number): ScheduledLine[] {
    const out: ScheduledLine[] = [];
    const remaining: ScheduledLine[] = [];

    for (const line of this.queue) {
      if (line.start_t_ms > t_ms) {
        remaining.push(line);
        continue;
      }

      const free = this.nextFree[line.channel] ?? 0;
      if (line.start_t_ms < free) {
        // Channel busy. If we're inside the backlog window, hold; else drop.
        if (free - line.start_t_ms <= this.backlogDropMs) {
          remaining.push({ ...line, start_t_ms: free });
        }
        continue;
      }

      out.push(line);
      this.nextFree[line.channel] = line.start_t_ms + line.duration_ms + this.channelCooldownMs;
    }

    this.queue = remaining;
    return out;
  }

  /** For tests / debugging: how many lines are scheduled. */
  pending(): number {
    return this.queue.length;
  }
}
