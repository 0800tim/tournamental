/**
 * Replay buffer — circular buffer of {playersPos, ballPos, time}
 * snapshots, used to play back the last 10 seconds at 0.25× during
 * goal replays.
 *
 * Per `docs/27b-fidelity-phase2-physics-director.md`:
 *
 *   Circular buffer holds the last 10 seconds of
 *   `{playersPosArray, ballPos, time}` at 60Hz. ~36 KB. On goal, the
 *   renderer plays back this buffer through the mixer at 0.25×,
 *   post-FX boosted.
 *
 * Sizing math: 10 s × 60 Hz × (22 players × 12 bytes + 12 bytes ball +
 * 4 bytes time) ≈ 36 KB. Negligible.
 */
import type { Vec2, Vec3 } from "@vtorn/spec";

export interface ReplaySnapshot {
  /** Scene clock ms. */
  t: number;
  /** Ball world position. */
  ball: Vec3;
  /** Players: id + 2D pitch position + facing yaw. */
  players: Array<{ id: string; pos: Vec2; facing: number }>;
}

export interface ReplayBufferOptions {
  /** Buffer length in seconds. Default 10. */
  durationSec?: number;
  /** Sample rate Hz. Default 60. */
  rateHz?: number;
}

/**
 * Fixed-size circular buffer of `ReplaySnapshot`s.
 *
 * Methods:
 *
 *   - `push(snap)`     — record a frame. O(1) amortised; oldest entry
 *                        is overwritten when full.
 *   - `read(window)`   — copy out the last `windowSec` seconds in
 *                        time-ascending order. O(N).
 *   - `clear()`        — reset.
 *   - `length`         — number of snapshots currently held.
 */
export class ReplayBuffer {
  readonly capacity: number;
  private readonly storage: Array<ReplaySnapshot | null>;
  private head = 0;
  private size = 0;

  constructor(opts: ReplayBufferOptions = {}) {
    const durationSec = opts.durationSec ?? 10;
    const rateHz = opts.rateHz ?? 60;
    this.capacity = Math.max(1, Math.ceil(durationSec * rateHz));
    this.storage = new Array(this.capacity).fill(null);
  }

  /** Number of snapshots currently held. */
  get length(): number {
    return this.size;
  }

  /** Push a snapshot. Overwrites the oldest if the buffer is full. */
  push(snap: ReplaySnapshot): void {
    this.storage[this.head] = snap;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  /** Reset to empty. */
  clear(): void {
    for (let i = 0; i < this.capacity; i++) this.storage[i] = null;
    this.head = 0;
    this.size = 0;
  }

  /**
   * Read out the last `windowSec` seconds of snapshots, oldest first.
   * `now` is the current scene clock ms; the function uses it to drop
   * stale frames (e.g. if the scene paused for 30s the buffer still
   * exists but is "stale" and should be ignored).
   */
  read(windowSec: number, now: number): ReplaySnapshot[] {
    const cutoff = now - windowSec * 1000;
    const out: ReplaySnapshot[] = [];
    if (this.size === 0) return out;
    const start = (this.head - this.size + this.capacity) % this.capacity;
    for (let i = 0; i < this.size; i++) {
      const idx = (start + i) % this.capacity;
      const s = this.storage[idx];
      if (s && s.t >= cutoff) out.push(s);
    }
    return out;
  }

  /** Read all stored snapshots, oldest first. */
  readAll(): ReplaySnapshot[] {
    const out: ReplaySnapshot[] = [];
    if (this.size === 0) return out;
    const start = (this.head - this.size + this.capacity) % this.capacity;
    for (let i = 0; i < this.size; i++) {
      const idx = (start + i) % this.capacity;
      const s = this.storage[idx];
      if (s) out.push(s);
    }
    return out;
  }

  /**
   * Approximate memory footprint in bytes (for budget audit).
   *
   *   per snapshot ≈ 8 (t) + 24 (ball Vec3) + N · (8 (id ptr) + 16 (Vec2) + 8 (facing))
   *   ≈ 8 + 24 + 22·32 = ~736 B
   *   · 600 snapshots = ~440 KB
   *
   * Caller should keep `playersPosArray` length ≤ 22 to honour the
   * 36 KB envelope quoted in the spec — the spec's number assumes
   * Float32Array packing (3·22·4 = 264 B per frame); JS arrays are
   * fatter. For Phase 2 we accept the higher footprint and revisit
   * with a packed Float32Array layout in Phase 4.
   */
  estimatedBytes(): number {
    if (this.size === 0) return 0;
    const sample = this.storage[(this.head - 1 + this.capacity) % this.capacity];
    if (!sample) return 0;
    const perSnap = 8 + 24 + sample.players.length * 32;
    return perSnap * this.size;
  }
}
