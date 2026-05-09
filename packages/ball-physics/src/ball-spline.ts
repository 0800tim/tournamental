/**
 * Spline-mode ball trajectory.
 *
 * Per `docs/27b-fidelity-phase2-physics-director.md` § "Ball physics":
 * 95% of ball motion uses a Catmull-Rom spline through (start, apex,
 * end) with a per-shot ease-out on the time axis. This is *cheap* —
 * zero physics overhead, deterministic, and matches what producers
 * already emit (the spec carries `BallState.pos` + `vel` per frame; a
 * shot event provides start/target).
 *
 * The spline mode is the default. Rapier mode (in `ball-rapier.ts`)
 * takes over for free kicks, post rebounds, and corners.
 *
 * The math is pure: vector in / vector out. No three.js dependency in
 * the call signatures (we accept any `[x, y, z]` array). Three.js's
 * `CatmullRomCurve3` does the heavy lifting on the renderer side
 * once we hand it the control points.
 */
import type { Vec3 } from "@vtorn/spec";

export interface BallTrajectoryOptions {
  /**
   * Catmull-Rom alpha. 0.5 = centripetal (recommended; no cusps),
   * 0 = uniform, 1 = chordal. Default 0.5.
   */
  alpha?: number;
  /**
   * Time-axis ease-out exponent. 1 = linear; 2 = ease-out (slows as
   * the ball nears the target). Default 1.5.
   */
  easeOutExponent?: number;
  /** Tension parameter [0, 1]. 0 = none. Default 0. */
  tension?: number;
}

export interface BallShotInputs {
  /** Start position (where the kick happens). */
  start: Vec3;
  /** End position (where the ball lands or is received). */
  end: Vec3;
  /** Apex (max-height) position. If not provided, derived from start/end + initial speed. */
  apex?: Vec3;
  /** Initial speed in m/s. Used to derive apex when one is not provided. */
  initialSpeed?: number;
  /** Total flight duration in seconds. */
  durationSec: number;
  /** Optional Magnus side-force preview — see `magnus.ts`. */
  sideForce?: Vec3;
}

/**
 * Catmull-Rom interpolation through 4 control points (P0..P3) at
 * parameter `t` ∈ [0, 1]. `alpha` selects the parameterisation:
 *
 *   - alpha=0   uniform
 *   - alpha=0.5 centripetal (no cusps; recommended)
 *   - alpha=1   chordal
 *
 * Implementation follows the canonical centripetal C-R formulation.
 */
export function catmullRomCentripetal(
  P0: Vec3,
  P1: Vec3,
  P2: Vec3,
  P3: Vec3,
  t: number,
  alpha = 0.5,
): Vec3 {
  const dist = (a: Vec3, b: Vec3): number =>
    Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

  const t0 = 0;
  const t1 = t0 + Math.pow(Math.max(dist(P0, P1), 1e-6), alpha);
  const t2 = t1 + Math.pow(Math.max(dist(P1, P2), 1e-6), alpha);
  const t3 = t2 + Math.pow(Math.max(dist(P2, P3), 1e-6), alpha);

  // Map t ∈ [0,1] to the spline interval [t1, t2].
  const u = t1 + (t2 - t1) * t;

  // De Casteljau-like Catmull-Rom evaluation.
  const lerp = (a: Vec3, b: Vec3, ta: number, tb: number, tt: number): Vec3 => {
    if (Math.abs(tb - ta) < 1e-9) return a;
    const k = (tt - ta) / (tb - ta);
    return [
      a[0] + (b[0] - a[0]) * k,
      a[1] + (b[1] - a[1]) * k,
      a[2] + (b[2] - a[2]) * k,
    ];
  };

  const A1 = lerp(P0, P1, t0, t1, u);
  const A2 = lerp(P1, P2, t1, t2, u);
  const A3 = lerp(P2, P3, t2, t3, u);
  const B1 = lerp(A1, A2, t0, t2, u);
  const B2 = lerp(A2, A3, t1, t3, u);
  return lerp(B1, B2, t1, t2, u);
}

/**
 * Derive the apex of a kick from start/end + assumed initial speed.
 *
 * Treats the kick as a parabolic projectile (g=9.81) and computes the
 * peak height for the launch angle that would land the ball at
 * `end` — falls back to a reasonable arc if the inputs are
 * inconsistent.
 *
 *   range = v² sin(2θ) / g  →  θ = ½ asin(g·range / v²)
 *   apex  = v² sin²(θ) / (2g)
 */
export function deriveApex(start: Vec3, end: Vec3, initialSpeed: number): Vec3 {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const dz = end[2] - start[2];
  const range = Math.hypot(dx, dy);
  const v = Math.max(initialSpeed, 1);
  const g = 9.81;

  // If the kick is short relative to the kick speed, sin(2θ) > 1 →
  // clamp angle to 45°.
  const sin2theta = Math.min(1, (g * range) / (v * v));
  const theta = 0.5 * Math.asin(sin2theta);
  const apexHeight = (v * v * Math.sin(theta) * Math.sin(theta)) / (2 * g);

  // Apex sits at the midpoint of the horizontal kick path, at apexHeight.
  const midX = (start[0] + end[0]) / 2;
  const midY = (start[1] + end[1]) / 2;
  const midZ = (start[2] + end[2]) / 2 + apexHeight;
  void dz;
  return [midX, midY, midZ];
}

/**
 * Sample the ball position at `t` ∈ [0, 1] along the kick trajectory.
 *
 *   - t=0 → start
 *   - t=1 → end
 *   - intermediate t → smooth Catmull-Rom curve passing through
 *     (start, apex, end), with optional ease-out on the time axis and
 *     a Magnus side-force perturbation.
 */
export function sampleBallTrajectory(
  inputs: BallShotInputs,
  t: number,
  options: BallTrajectoryOptions = {},
): Vec3 {
  const easeExp = options.easeOutExponent ?? 1.5;
  const alpha = options.alpha ?? 0.5;
  const apex =
    inputs.apex ?? deriveApex(inputs.start, inputs.end, inputs.initialSpeed ?? 18);

  // Clamp & ease the time axis.
  const tt = Math.max(0, Math.min(1, t));
  const eased = 1 - Math.pow(1 - tt, easeExp);

  // Build 4 control points: P0 = mirror of P1 around start, P1 = start,
  // P2 = apex, P3 = end + tangent extension. We use a phantom P0/P4
  // outside the spline range so the curve cleanly enters/exits.
  const P1 = inputs.start;
  const P2 = apex;
  const P3 = inputs.end;
  const P0: Vec3 = [
    2 * P1[0] - P2[0],
    2 * P1[1] - P2[1],
    Math.max(0, P1[2] * 0.5),
  ];
  // Extra phantom past P3, used by the C-R 4-point evaluation.
  const P4: Vec3 = [
    2 * P3[0] - P2[0],
    2 * P3[1] - P2[1],
    Math.max(0, P3[2] * 0.5),
  ];

  // We only really need 4 points for a single Catmull-Rom segment.
  // For our 3-point input (start, apex, end) we evaluate on
  // (P1→P2 segment) for u<0.5 and (P2→P3 segment) for u>=0.5.
  let pos: Vec3;
  if (eased < 0.5) {
    pos = catmullRomCentripetal(P0, P1, P2, P3, eased * 2, alpha);
  } else {
    pos = catmullRomCentripetal(P1, P2, P3, P4, (eased - 0.5) * 2, alpha);
  }

  // Magnus preview: lateral offset that grows with t(1−t) so it's zero
  // at the endpoints and peaks mid-flight. Caller-supplied vector.
  if (inputs.sideForce) {
    const k = tt * (1 - tt) * 4; // bell shape, peak 1.0 at t=0.5
    pos[0] += inputs.sideForce[0] * k;
    pos[1] += inputs.sideForce[1] * k;
    pos[2] += inputs.sideForce[2] * k;
  }

  return pos;
}

/** Sample the ball velocity at `t` via finite difference. */
export function sampleBallVelocity(
  inputs: BallShotInputs,
  t: number,
  options: BallTrajectoryOptions = {},
): Vec3 {
  const dt = 1 / 60;
  const a = sampleBallTrajectory(inputs, Math.max(0, t - dt), options);
  const b = sampleBallTrajectory(inputs, Math.min(1, t + dt), options);
  const span = Math.min(1, t + dt) - Math.max(0, t - dt);
  const dur = inputs.durationSec * Math.max(span, 1e-6);
  return [
    (b[0] - a[0]) / dur,
    (b[1] - a[1]) / dur,
    (b[2] - a[2]) / dur,
  ];
}

/** Convenience: build an N-sample trajectory polyline. */
export function buildBallTrajectoryPolyline(
  inputs: BallShotInputs,
  samples: number,
  options: BallTrajectoryOptions = {},
): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i <= samples; i++) {
    out.push(sampleBallTrajectory(inputs, i / samples, options));
  }
  return out;
}
