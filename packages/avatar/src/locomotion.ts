/**
 * Phase-locked locomotion math.
 *
 * The "no foot sliding" trick: scale the AnimationMixer's timescale so
 * the clip's natural ground-speed matches the avatar's actual ground
 * speed. Per docs/27a:
 *
 *   playbackRate = velocityMagnitude / clipNaturalSpeed
 *
 * Two practical safety rails on top:
 *
 *  1. **Clamp** the rate to a sane range (default 0.5–1.75). Outside
 *     that the animation either looks like a slideshow (too slow) or
 *     hyper-cartoon (too fast) and we'd rather hold the previous state.
 *
 *  2. When the natural speed is ~0 (idle clip), or the velocity is ~0
 *     (player standing still on a `walk` clip), return 1 so the mixer
 *     keeps playing at clip rate rather than dividing by zero.
 *
 * The function is pure so it unit-tests cleanly without three.js.
 */

export interface PhaseLockOptions {
  /** Lower bound on the playback rate. Default 0.5. */
  min?: number;
  /** Upper bound on the playback rate. Default 1.75. */
  max?: number;
  /** Below this velocity (m/s), force rate=1 (don't stretch idle/walk). */
  minVelocity?: number;
  /** Below this natural speed (m/s), force rate=1. */
  minNaturalSpeed?: number;
}

/**
 * Compute the AnimationMixer time-scale that keeps feet planted.
 *
 *   `velocity`    — magnitude in m/s (≥ 0).
 *   `naturalSpeed` — clip's natural ground speed in m/s (≥ 0).
 */
export function phaseLockRate(
  velocity: number,
  naturalSpeed: number,
  options: PhaseLockOptions = {},
): number {
  const min = options.min ?? 0.5;
  const max = options.max ?? 1.75;
  const minVel = options.minVelocity ?? 0.01;
  const minNat = options.minNaturalSpeed ?? 0.05;

  if (!Number.isFinite(velocity) || velocity <= minVel) return 1;
  if (!Number.isFinite(naturalSpeed) || naturalSpeed <= minNat) return 1;

  const raw = velocity / naturalSpeed;
  if (raw < min) return min;
  if (raw > max) return max;
  return raw;
}

/**
 * Estimate the *foot-slide drift* that accumulates over a window when
 * we don't phase-lock. Used by the locomotion test suite to assert the
 * lock keeps drift < 0.05 m/s mean over 30s of synthetic velocity.
 *
 *   - `samples` — array of (velocity m/s, naturalSpeed m/s, dt seconds).
 *   - returns mean absolute drift in m/s.
 *
 * Drift = velocity − (naturalSpeed × playbackRate). With a perfect
 * phase-lock, drift collapses to 0 inside the clamp window.
 */
export function meanFootSlide(
  samples: Array<{ velocity: number; naturalSpeed: number; dt: number }>,
  options: PhaseLockOptions = {},
): number {
  if (samples.length === 0) return 0;
  let weighted = 0;
  let total = 0;
  for (const s of samples) {
    const rate = phaseLockRate(s.velocity, s.naturalSpeed, options);
    const drift = Math.abs(s.velocity - s.naturalSpeed * rate);
    weighted += drift * s.dt;
    total += s.dt;
  }
  return total > 0 ? weighted / total : 0;
}

/**
 * Pick the locomotion clip whose natural speed best matches `velocity`.
 *
 *   - `naturalSpeeds` — { tag → m/s }.
 *   - returns the tag with the smallest |natural − velocity| inside the
 *     phase-lock clamp. If nothing fits, returns `idle` (or the first
 *     entry).
 */
export function bestLocomotionForSpeed<T extends string>(
  velocity: number,
  naturalSpeeds: Partial<Record<T, number>>,
  options: PhaseLockOptions = {},
): T | null {
  const entries = Object.entries(naturalSpeeds) as Array<[T, number | undefined]>;
  if (entries.length === 0) return null;
  const min = options.min ?? 0.5;
  const max = options.max ?? 1.75;

  let best: T | null = null;
  let bestErr = Infinity;
  for (const [tag, natural] of entries) {
    if (natural === undefined) continue;
    if (natural <= 0) {
      // Idle clip: only choose when velocity is near 0.
      if (velocity < 0.3 && bestErr > velocity) {
        best = tag;
        bestErr = velocity;
      }
      continue;
    }
    const ratio = velocity / natural;
    // Hard reject if the rate would clamp far outside its window.
    if (ratio < min * 0.5 || ratio > max * 1.5) continue;
    const err = Math.abs(natural - velocity);
    if (err < bestErr) {
      bestErr = err;
      best = tag;
    }
  }
  if (best === null && entries.length > 0) best = entries[0][0];
  return best;
}
