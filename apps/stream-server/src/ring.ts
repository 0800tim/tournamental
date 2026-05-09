/**
 * In-memory ring of recent stream messages for a single match.
 *
 * The ring keeps:
 *   - one cached `MatchInit` (the most recent seen).
 *   - a sliding window of the last `windowMs` of frames (state + events).
 *
 * Eviction is *not* time-based against wall-clock — it's against
 * `t` on the newest frame seen. This matches the spec: `t` is the
 * authoritative match clock, so a producer that stalls and resumes
 * doesn't have its ring crushed by wall time.
 *
 * The ring exposes:
 *   - `push(msg)` to add a frame.
 *   - `summary()` for hello-on-connect.
 *   - `replay()` to send the cached init + recent frames to a new
 *     subscriber.
 *
 * It does NOT do fan-out; the SubscriberHub does. Decoupled because the
 * ring is shared state and fan-out is per-subscriber.
 */

import type {
  MatchInit,
  Message,
  StateFrame,
  EventMessage,
} from "@vtorn/spec";

/** A non-init message: state frame or event. */
export type FrameMessage = StateFrame | EventMessage;

export interface RingSummary {
  match_id: string;
  has_init: boolean;
  frames: number;
  /** ms; `tNewest - tOldest` of frames currently buffered. */
  span_ms: number;
  /** `t` of the newest frame. 0 if empty. */
  t_newest: number;
  /** `t` of the oldest frame. 0 if empty. */
  t_oldest: number;
  /** Wall-clock ms since the newest frame was pushed. */
  age_ms: number;
}

export class MatchRing {
  private init: MatchInit | undefined;
  private frames: FrameMessage[] = [];
  private windowMs: number;
  private lastPushAt = 0;

  constructor(windowMs: number) {
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new Error(`MatchRing windowMs must be > 0, got ${windowMs}`);
    }
    this.windowMs = windowMs;
  }

  /**
   * Add a message to the ring. Returns true if accepted.
   * Init messages replace the cached init (later inits with the same
   * match_id are honoured — useful for reconnects).
   */
  push(msg: Message): void {
    this.lastPushAt = Date.now();
    if (msg.type === "match.init") {
      this.init = msg;
      return;
    }
    // FrameMessage: has `t`.
    this.frames.push(msg);
    this.evict();
  }

  private evict(): void {
    if (this.frames.length === 0) return;
    const newest = this.frames[this.frames.length - 1]!.t;
    const cutoff = newest - this.windowMs;
    // Remove from the front while the oldest is older than cutoff.
    let drop = 0;
    while (drop < this.frames.length && this.frames[drop]!.t < cutoff) {
      drop += 1;
    }
    if (drop > 0) {
      this.frames.splice(0, drop);
    }
  }

  hasInit(): boolean {
    return this.init !== undefined;
  }

  getInit(): MatchInit | undefined {
    return this.init;
  }

  /** Number of non-init frames currently in the ring. */
  size(): number {
    return this.frames.length;
  }

  /** A copy of the buffered frames, oldest first. */
  snapshotFrames(): FrameMessage[] {
    return this.frames.slice();
  }

  summary(): RingSummary {
    const id = this.init?.match_id ?? "";
    if (this.frames.length === 0) {
      return {
        match_id: id,
        has_init: this.hasInit(),
        frames: 0,
        span_ms: 0,
        t_newest: 0,
        t_oldest: 0,
        age_ms: this.lastPushAt === 0 ? 0 : Date.now() - this.lastPushAt,
      };
    }
    const tOldest = this.frames[0]!.t;
    const tNewest = this.frames[this.frames.length - 1]!.t;
    return {
      match_id: id,
      has_init: this.hasInit(),
      frames: this.frames.length,
      span_ms: tNewest - tOldest,
      t_newest: tNewest,
      t_oldest: tOldest,
      age_ms: Date.now() - this.lastPushAt,
    };
  }

  /** Wall-clock ms since the last push, or `Infinity` if never pushed. */
  ageMs(): number {
    if (this.lastPushAt === 0) return Number.POSITIVE_INFINITY;
    return Date.now() - this.lastPushAt;
  }
}
