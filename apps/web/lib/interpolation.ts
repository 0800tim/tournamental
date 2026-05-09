import type { BallState, PlayerState, StateFrame, Vec2, Vec3 } from "@vtorn/spec";

export const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const lerpVec2 = (a: Vec2, b: Vec2, t: number): Vec2 => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
];

export const lerpVec3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

/**
 * Shortest-path angular interpolation. Both inputs are radians; output is
 * the interpolated radian value, NOT normalised. This avoids the wrap-around
 * jump bug when, e.g., a player rotates from yaw=π−0.1 to yaw=−π+0.1.
 */
export function slerpAngle(a: number, b: number, t: number): number {
  const TAU = Math.PI * 2;
  let delta = ((b - a) % TAU + TAU * 1.5) % TAU - Math.PI;
  return a + delta * t;
}

/**
 * Compute the lerp alpha given the wall-clock arrival times of the previous
 * and current frames and `now`. Clamped to [0, 1] so we never extrapolate
 * past the current frame from this helper. (Extrapolation, when we want it,
 * is opt-in via `extrapolateBall`.)
 */
export function alphaForNow(
  prevWallMs: number,
  currWallMs: number,
  now: number,
): number {
  const span = currWallMs - prevWallMs;
  if (span <= 0) return 1;
  return clamp01((now - currWallMs) / span + 1);
}

/** Find the player's state in a frame, or null if absent. */
export function findPlayer(frame: StateFrame | null, id: string): PlayerState | null {
  if (!frame) return null;
  for (const p of frame.players) if (p.id === id) return p;
  return null;
}

/**
 * Interpolated player state at fractional progress alpha between prev and
 * curr frames. Returns curr's animation tag (animation events are discrete,
 * not lerped).
 */
export function interpolatePlayer(
  prev: StateFrame | null,
  curr: StateFrame | null,
  id: string,
  alpha: number,
): PlayerState | null {
  const c = findPlayer(curr, id);
  if (!c) return null;
  const p = findPlayer(prev, id);
  if (!p) return c;
  return {
    id: c.id,
    pos: lerpVec2(p.pos, c.pos, alpha),
    facing: slerpAngle(p.facing, c.facing, alpha),
    anim: c.anim,
    has_ball: c.has_ball,
    fatigue: c.fatigue,
  };
}

/** Interpolated ball state. */
export function interpolateBall(
  prev: StateFrame | null,
  curr: StateFrame | null,
  alpha: number,
): BallState | null {
  if (!curr) return null;
  if (!prev) return curr.ball;
  return {
    pos: lerpVec3(prev.ball.pos, curr.ball.pos, alpha),
    vel: curr.ball.vel,
    carrier: curr.ball.carrier,
  };
}

/**
 * Forward-extrapolate the ball ~Δt ms beyond `curr` using its velocity,
 * capped at `maxMs` (so we don't fling the ball off the screen if the
 * stream stalls). Doc 04 calls for ~200ms of extrapolation.
 */
export function extrapolateBall(curr: BallState, dtMs: number, maxMs = 200): BallState {
  if (!curr.vel) return curr;
  const t = Math.min(dtMs, maxMs) / 1000;
  return {
    pos: [curr.pos[0] + curr.vel[0] * t, curr.pos[1] + curr.vel[1] * t, curr.pos[2] + curr.vel[2] * t],
    vel: curr.vel,
    carrier: curr.carrier,
  };
}

/**
 * Estimate a player's instantaneous speed (magnitude, in spec units/sec) from
 * two consecutive frames. Returns 0 if either frame is missing.
 */
export function estimateSpeed(
  prev: StateFrame | null,
  curr: StateFrame | null,
  id: string,
): number {
  if (!prev || !curr) return 0;
  const a = findPlayer(prev, id);
  const b = findPlayer(curr, id);
  if (!a || !b) return 0;
  const dt = (curr.t - prev.t) / 1000;
  if (dt <= 0) return 0;
  const dx = b.pos[0] - a.pos[0];
  const dy = b.pos[1] - a.pos[1];
  return Math.hypot(dx, dy) / dt;
}
