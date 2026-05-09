/**
 * Magnus-effect model — full Phase-4 realisation.
 *
 * Phase 2 shipped a "side-force preview": a constant scalar lateral
 * displacement (~0.4 m at strength 0.5) tacked on to the spline by
 * `sampleBallTrajectory`. That was deliberately cheap and visually
 * convincing for in-swinging crosses, but it never modelled spin in any
 * physically defensible way.
 *
 * Phase 4 keeps the Phase-2 surface (`magnusSideForce` still returns a
 * `Vec3` that the spline integrator multiplies through a
 * t(1−t)·4 bell-shape) but layers on:
 *
 *   1. A *spin estimator* that maps shot-category metadata + kicker
 *      preferences to an angular-velocity vector ω in rad/s.
 *   2. A *physical side-force* function for the rapier-driven free-kick
 *      lane:
 *
 *        F_m = ½ · ρ · A · C_l · |v|² · (ω̂ × v̂)
 *
 *      with C_l ≈ 0.25 for a stitched football at standard dimples.
 *   3. A scalar "peak lateral offset" projection so the spline mode can
 *      stay visually consistent with the rapier mode without doing a
 *      full integrator step in the renderer's hot path.
 *
 * Calibration target (per `docs/27d-fidelity-phase4-magnus-mobile.md`):
 *
 *   - Free kick at 25 m, v=27 m/s, spin ≈ 10 rev/s ≈ 63 rad/s on the
 *     vertical axis → expect lateral offset of ~ 1.5 m at the goal-line
 *     (matches the visible curl on Messi's free kicks vs Mexico 2022).
 *
 * The math is pure — no three.js. Vec3 in / Vec3 out.
 *
 * Reference physics (Goff & Carré 2010; Kray et al. 2014).
 */
import type { Vec3 } from "@vtorn/spec";
import { BALL_CONSTANTS } from "./ball-rapier.js";

export type CurlDirection =
  | "left"
  | "right"
  | "none"
  | "topspin"
  | "backspin"
  | "knuckle";

export type ShotCategory =
  | "pass"
  | "long_pass"
  | "outside_foot_pass"
  | "shot"
  | "free_kick"
  | "corner"
  | "knuckleball"
  | "lob"
  | "penalty";

export interface MagnusInputs {
  travelDir: Vec3;
  upAxis?: Vec3;
  curl: CurlDirection;
  strength?: number;
}

export interface SpinEstimatorInputs {
  category: ShotCategory;
  preferredFoot?: "left" | "right" | "either";
  runUpAngleDeg?: number;
  speed?: number;
}

export interface MagnusSpinEstimate {
  curl: CurlDirection;
  omega: Vec3;
  revPerSec: number;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalise(v: Vec3): Vec3 {
  const m = Math.hypot(v[0], v[1], v[2]);
  if (m < 1e-9) return [0, 0, 0];
  return [v[0] / m, v[1] / m, v[2] / m];
}

/**
 * Spin coefficient C_l for a stitched football. Piecewise-linear fit
 * across spin parameter S = ωr / v.
 */
export function liftCoefficient(spinParameter: number): number {
  const S = Math.abs(spinParameter);
  if (S < 0.05) return 0;
  if (S < 0.15) return 0.18 + ((S - 0.05) / 0.10) * (0.25 - 0.18);
  if (S < 0.30) return 0.25 + ((S - 0.15) / 0.15) * (0.32 - 0.25);
  return 0.32;
}

export function spinParameter(omegaRadPerSec: number, speed: number): number {
  if (speed <= 1e-6) return 0;
  return (omegaRadPerSec * BALL_CONSTANTS.radius) / speed;
}

/**
 * Estimate per-shot spin from event metadata.
 *
 * Per-category baselines (rev/s; matches Goff & Carré 2010):
 *   - free_kick: ~10, corner: ~8, shot: ~5, long_pass: ~4,
 *     outside_foot_pass: ~6, pass: ~2, lob: ~3 (backspin),
 *     penalty: ~4, knuckleball: 0.
 *
 * Spline-preview convention: a right-foot in-swinger is `curl: "left"`
 * because magnusSideForce({curl:"left"}) gives +y for travel +x.
 */
export function magnusSpinFromShot(
  inputs: SpinEstimatorInputs,
): MagnusSpinEstimate {
  const baseRevPerSec: Record<ShotCategory, number> = {
    pass: 2,
    long_pass: 4,
    outside_foot_pass: 6,
    shot: 5,
    free_kick: 10,
    corner: 8,
    knuckleball: 0,
    lob: 3,
    penalty: 4,
  };
  const rev = baseRevPerSec[inputs.category] ?? 0;
  if (rev === 0) {
    return {
      curl: inputs.category === "knuckleball" ? "knuckle" : "none",
      omega: [0, 0, 0],
      revPerSec: 0,
    };
  }

  const foot = inputs.preferredFoot ?? "right";
  const runUpAngle =
    inputs.runUpAngleDeg ??
    (foot === "left" ? -25 : foot === "either" ? 0 : 25);

  const verticalSign = Math.sign(runUpAngle) || (foot === "left" ? -1 : 1);

  if (inputs.category === "lob") {
    return { curl: "backspin", omega: [0, 0, 0], revPerSec: rev };
  }

  const omegaMag = rev * 2 * Math.PI;
  return {
    curl: verticalSign >= 0 ? "left" : "right",
    omega: [0, 0, verticalSign * omegaMag],
    revPerSec: rev,
  };
}

/** Phase-2-compatible side-force vector consumed by the spline mode. */
export function magnusSideForce(inputs: MagnusInputs): Vec3 {
  const strength = inputs.strength ?? 0.5;
  const upAxis = inputs.upAxis ?? [0, 0, 1];
  const dir = normalise(inputs.travelDir);
  const up = normalise(upAxis);

  switch (inputs.curl) {
    case "none":
    case "knuckle":
      return [0, 0, 0];
    case "left": {
      const side = normalise(cross(up, dir));
      return [side[0] * strength, side[1] * strength, side[2] * strength];
    }
    case "right": {
      const side = normalise(cross(dir, up));
      return [side[0] * strength, side[1] * strength, side[2] * strength];
    }
    case "topspin":
      return [-up[0] * strength * 0.6, -up[1] * strength * 0.6, -up[2] * strength * 0.6];
    case "backspin":
      return [up[0] * strength * 0.6, up[1] * strength * 0.6, up[2] * strength * 0.6];
  }
}

/**
 * Physical Magnus *force* for the rapier-driven free-kick lane.
 *   F_m = ½ · ρ · A · C_l · |v|² · (ω̂ × v̂)
 */
export function magnusForce(omega: Vec3, velocity: Vec3): Vec3 {
  const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
  if (speed < 1e-3) return [0, 0, 0];

  const omegaMag = Math.hypot(omega[0], omega[1], omega[2]);
  if (omegaMag < 1e-6) return [0, 0, 0];

  const S = spinParameter(omegaMag, speed);
  const Cl = liftCoefficient(S);
  if (Cl === 0) return [0, 0, 0];

  const A = Math.PI * BALL_CONSTANTS.radius * BALL_CONSTANTS.radius;
  const factor = 0.5 * BALL_CONSTANTS.airDensity * Cl * A * speed * speed;

  const omegaHat: Vec3 = [omega[0] / omegaMag, omega[1] / omegaMag, omega[2] / omegaMag];
  const velHat: Vec3 = [velocity[0] / speed, velocity[1] / speed, velocity[2] / speed];
  const cx = omegaHat[1] * velHat[2] - omegaHat[2] * velHat[1];
  const cy = omegaHat[2] * velHat[0] - omegaHat[0] * velHat[2];
  const cz = omegaHat[0] * velHat[1] - omegaHat[1] * velHat[0];
  const cmag = Math.hypot(cx, cy, cz);
  if (cmag < 1e-9) return [0, 0, 0];

  return [(cx / cmag) * factor, (cy / cmag) * factor, (cz / cmag) * factor];
}

/**
 * Project the physical Magnus model down to a "peak lateral offset"
 * scalar (metres) suitable for the spline mode's `sideForce` surface.
 *
 * Lateral displacement over flight ≈ ½ · a_⊥ · T² ; spline preview
 * uses a t(1−t)·4 bell with peak 1 at t=0.5, so mid-flight offset is
 * 1/8 · a_⊥ · T².
 */
export function splinePeakLateralOffset(
  omega: Vec3,
  speed: number,
  flightSec: number,
): number {
  if (speed < 1e-3 || flightSec < 1e-3) return 0;
  const v: Vec3 = [speed, 0, 0];
  const F = magnusForce(omega, v);
  const Fmag = Math.hypot(F[0], F[1], F[2]);
  const a = Fmag / BALL_CONSTANTS.mass;
  return 0.125 * a * flightSec * flightSec;
}

export function inferCurl(
  eventType: string,
  preferredFoot: "left" | "right" | "either" = "right",
): CurlDirection {
  if (eventType === "event.shot" || eventType === "event.pass") {
    return preferredFoot === "left" ? "right" : "left";
  }
  if (eventType === "event.out_of_bounds") return "none";
  return "none";
}

/** High-level helper: derive the spline mode's `sideForce` Vec3. */
export function magnusSplineSideForce(
  estimator: SpinEstimatorInputs,
  travelDir: Vec3,
  flightSec: number,
): Vec3 {
  const spin = magnusSpinFromShot(estimator);
  if (spin.curl === "none" || spin.curl === "knuckle") return [0, 0, 0];

  if (spin.curl === "backspin" || spin.curl === "topspin") {
    const strength = Math.min(0.6, spin.revPerSec / 12);
    return magnusSideForce({ travelDir, curl: spin.curl, strength });
  }

  const speed = estimator.speed ?? 18;
  const offset = splinePeakLateralOffset(spin.omega, speed, flightSec);
  const strength = Math.max(0, Math.min(2, offset));
  return magnusSideForce({ travelDir, curl: spin.curl, strength });
}
