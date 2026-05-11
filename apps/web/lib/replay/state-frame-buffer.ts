/**
 * Match-time state-frame buffer with smooth interpolation.
 *
 * Background, why this exists:
 *
 * The old renderer pipeline used `alphaForNow(prevWallMs, currWallMs, now)`
 * to lerp between the store's `prev` and `curr` state frames. That works
 * for a clean live WebSocket stream where one frame arrives every 100 ms
 * and `Date.now() - currWallMs` is a sensible alpha source.
 *
 * It does NOT work for the synthetic AR-FR producer (or any other batched
 * source). The synthetic source paces ~7300 messages over ~90 s of wall-
 * clock at `messagesPerTick ≈ 4` each 50 ms tick. State frames are 1
 * *match-second* apart. When 4 frames land in one tick they all stamp the
 * store with the same wall-clock instant, so `prevWallMs === currWallMs`,
 * `alphaForNow` saturates at 1, and the renderer snaps to the last frame
 * with zero interpolation. Players move ~4 m/s in the synthetic, so the
 * snap is visible as a "teleport" every tick. Field/camera judder
 * follows.
 *
 * Fix: keep a small ring buffer of recent state frames, indexed by their
 * spec match-time `t` (not wall-clock). Track an *anchor*, the
 * wall-clock instant + the match-time of the most recent frame received
 * in real time. Whenever the renderer asks for the current pose, we
 * compute the active match-time from the anchor + elapsed wall-clock,
 * and `sampleAt(matchTime)` linearly interpolates between the two
 * bracketing frames. The ball uses Catmull-Rom across 4 frames for a
 * smoother trajectory on shots; players use linear pos + slerp yaw.
 *
 * This module is pure (no React, no THREE) so it's unit-testable in
 * jsdom and reusable by any consumer that has a `prev/curr` pair.
 */
import type { BallState, PlayerState, StateFrame, Vec2, Vec3 } from "@vtorn/spec";
import {
  clamp01,
  lerp,
  lerpVec2,
  lerpVec3,
  slerpAngle,
} from "../interpolation.js";

/** Default ring buffer capacity. 8 frames covers ~800 ms at 10 Hz. */
export const DEFAULT_BUFFER_FRAMES = 8;

/**
 * Public sample shape. We hand back a fully-interpolated StateFrame so
 * downstream code can use the same shape it already does.
 */
export interface InterpolatedFrame {
  t: number;
  ball: BallState;
  players: PlayerState[];
}

export interface StateFrameBufferOptions {
  /** Max number of frames to retain. Default 8. */
  capacity?: number;
  /**
   * Wall-clock provider. Defaults to `() => Date.now()`. Inject a fake
   * for tests.
   */
  now?: () => number;
}

interface Anchor {
  /** Wall-clock ms (monotonic-ish, defaults to Date.now()). */
  wallMs: number;
  /** Match-time ms anchored to wallMs. */
  matchMs: number;
}

/**
 * Match-time-aware state-frame ring buffer.
 *
 * Usage:
 *
 *   const buf = new StateFrameBuffer();
 *   // each time a state arrives in the store:
 *   buf.push(frame);
 *   // each render frame (60 Hz):
 *   const t = buf.currentMatchTime();
 *   const sample = buf.sampleAt(t);
 */
export class StateFrameBuffer {
  private frames: StateFrame[] = [];
  private capacity: number;
  private now: () => number;
  private anchor: Anchor | null = null;

  constructor(opts: StateFrameBufferOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_BUFFER_FRAMES;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Number of frames currently buffered. */
  size(): number {
    return this.frames.length;
  }

  /** Most recent buffered frame, or null. */
  latest(): StateFrame | null {
    return this.frames.length === 0 ? null : this.frames[this.frames.length - 1];
  }

  /** Reset buffer + anchor (e.g. on a manifest seek). */
  reset(): void {
    this.frames = [];
    this.anchor = null;
  }

  /**
   * Ingest one state frame. Frames must arrive monotonically in
   * `t` (match-time); out-of-order frames are dropped.
   *
   * Anchor logic:
   *   - First frame seeds the anchor at (wallNow, frame.t).
   *   - When a frame arrives whose match-time gap from the last anchor
   *     update is > the wall-clock gap (i.e. the source is bursting),
   *     we KEEP the anchor where it is, the renderer will read it
   *     forward at real-time pace and the catch-up happens via the
   *     `currentMatchTime()` ceiling logic on the next bursting wave.
   *   - When a frame arrives whose match-time gap matches wall-clock
   *     (≤1.2× tolerance), we slide the anchor forward, that's the
   *     normal real-time source case.
   */
  push(frame: StateFrame): void {
    if (this.frames.length > 0) {
      const tail = this.frames[this.frames.length - 1];
      if (frame.t <= tail.t) {
        // Out-of-order or duplicate; drop.
        return;
      }
    }
    this.frames.push(frame);
    while (this.frames.length > this.capacity) {
      this.frames.shift();
    }

    const wall = this.now();
    if (!this.anchor) {
      this.anchor = { wallMs: wall, matchMs: frame.t };
      return;
    }

    // Decide whether to slide the anchor forward.
    const wallGap = wall - this.anchor.wallMs;
    const matchGap = frame.t - this.anchor.matchMs;
    if (matchGap <= 0) return;

    // If the source is real-time-paced we expect matchGap ≈ wallGap.
    // Allow up to 25% drift either way before we treat it as a burst.
    const ratio = wallGap > 0 ? matchGap / wallGap : Infinity;
    if (ratio < 0.75 || ratio > 1.25) {
      // Burst (or stall). Don't slide, the consumer will sample at
      // real-time pace and naturally interpolate between the buffered
      // frames as wall-clock advances.
      return;
    }
    this.anchor = { wallMs: wall, matchMs: frame.t };
  }

  /**
   * Best-estimate of "what match-time is on screen right now". Reads
   * `wallNow - anchor.wall + anchor.match`, clamped to the buffered
   * range so we never extrapolate beyond what the producer has emitted.
   */
  currentMatchTime(): number {
    if (!this.anchor) return 0;
    const headT = this.frames.length > 0 ? this.frames[this.frames.length - 1].t : this.anchor.matchMs;
    const tailT = this.frames.length > 0 ? this.frames[0].t : this.anchor.matchMs;
    const wall = this.now();
    const target = this.anchor.matchMs + (wall - this.anchor.wallMs);
    if (target > headT) return headT;
    if (target < tailT) return tailT;
    return target;
  }

  /**
   * Sample interpolated state at `matchMs`. Returns null if no frames
   * have been buffered yet.
   *
   * Strategy:
   *   - Find the bracketing pair `[a, b]` such that `a.t <= matchMs <= b.t`.
   *   - Linear interpolation on each player's position (Vec2) and yaw
   *     (slerp shortest-arc).
   *   - Catmull-Rom across the four nearest frames for the ball
   *     trajectory when 4 are available; linear otherwise.
   *
   * Discrete-state fields (anim, has_ball, fatigue) are taken from the
   * "near-side" frame `b` to avoid blending non-numeric data.
   */
  sampleAt(matchMs: number): InterpolatedFrame | null {
    if (this.frames.length === 0) return null;
    if (this.frames.length === 1) {
      const f = this.frames[0];
      return {
        t: f.t,
        ball: { ...f.ball },
        players: f.players.map((p) => ({ ...p })),
      };
    }

    // Find bracketing indices via binary search.
    let lo = 0;
    let hi = this.frames.length - 1;
    if (matchMs <= this.frames[0].t) {
      const f = this.frames[0];
      return { t: f.t, ball: { ...f.ball }, players: f.players.map((p) => ({ ...p })) };
    }
    if (matchMs >= this.frames[hi].t) {
      const f = this.frames[hi];
      return { t: f.t, ball: { ...f.ball }, players: f.players.map((p) => ({ ...p })) };
    }
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.frames[mid].t <= matchMs) lo = mid;
      else hi = mid;
    }
    const a = this.frames[lo];
    const b = this.frames[hi];
    const span = b.t - a.t;
    const alpha = span > 0 ? clamp01((matchMs - a.t) / span) : 1;

    // --- Players: linear pos + slerp yaw ---
    // Match by id; use b's identities as the source of truth (which
    // mirrors how interpolatePlayer worked previously).
    const aById = new Map<string, PlayerState>();
    for (const p of a.players) aById.set(p.id, p);
    const players: PlayerState[] = b.players.map((bp) => {
      const ap = aById.get(bp.id);
      if (!ap) return { ...bp };
      return {
        id: bp.id,
        pos: lerpVec2(ap.pos, bp.pos, alpha) as Vec2,
        facing: slerpAngle(ap.facing, bp.facing, alpha),
        anim: bp.anim,
        has_ball: bp.has_ball,
        fatigue: bp.fatigue,
      };
    });

    // --- Ball: Catmull-Rom over 4 frames if available ---
    let ballPos: Vec3;
    if (lo > 0 && hi < this.frames.length - 1) {
      const p0 = this.frames[lo - 1].ball.pos;
      const p1 = a.ball.pos;
      const p2 = b.ball.pos;
      const p3 = this.frames[hi + 1].ball.pos;
      ballPos = catmullRom3(p0, p1, p2, p3, alpha);
    } else {
      ballPos = lerpVec3(a.ball.pos, b.ball.pos, alpha) as Vec3;
    }
    // Velocity is taken from b (instantaneous; not lerped).
    const ball: BallState = {
      pos: ballPos,
      vel: b.ball.vel,
      carrier: b.ball.carrier,
    };

    return { t: matchMs, ball, players };
  }

  /**
   * Convenience: sample at the inferred current match-time.
   */
  sample(): InterpolatedFrame | null {
    if (this.frames.length === 0) return null;
    return this.sampleAt(this.currentMatchTime());
  }

  /** Inspect anchor for debugging. */
  debugAnchor(): Anchor | null {
    return this.anchor ? { ...this.anchor } : null;
  }
}

/**
 * Catmull-Rom interpolation in 3D with tension 0.5. Visits four control
 * points (`p0, p1, p2, p3`), the active segment is `p1 → p2`, and `t`
 * runs in [0, 1] across that segment. Returns a Vec3 in spec coords.
 *
 * Reference: any standard catmull-rom; we use the half-tension form so
 * shoots/passes don't overshoot when the velocity vector flips sign.
 */
export function catmullRom3(
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
  t: number,
): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;

  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const a0 = p0[i];
    const a1 = p1[i];
    const a2 = p2[i];
    const a3 = p3[i];

    // Half-tension Catmull-Rom basis:
    //   q(t) = 0.5 * ((2*a1) + (-a0 + a2)*t + (2a0 - 5a1 + 4a2 - a3)*t² +
    //                 (-a0 + 3a1 - 3a2 + a3)*t³)
    out[i] =
      0.5 *
      (2 * a1 +
        (-a0 + a2) * t +
        (2 * a0 - 5 * a1 + 4 * a2 - a3) * t2 +
        (-a0 + 3 * a1 - 3 * a2 + a3) * t3);
  }
  return out;
}

/**
 * Linear ramp helper for tests / debugging, exposed so other modules
 * can compose match-time clocks without re-deriving the formula.
 */
export function lerpScalar(a: number, b: number, t: number): number {
  return lerp(a, b, t);
}
