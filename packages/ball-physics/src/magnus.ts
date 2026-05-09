/**
 * Magnus-effect side-force preview.
 *
 * Per `docs/27b-fidelity-phase2-physics-director.md` § "Magnus
 * (preview, full realisation in Phase 4)":
 *
 *   For free kicks and curling shots, modify the spline by adding a
 *   side-force vector orthogonal to the direction of travel. Magnitude
 *   proportional to assumed spin (constant for Phase 2).
 *
 * Phase 2 uses a *constant* spin assumption; Phase 4 will tune
 * coefficients per shot category (knuckle, top-spin, in/out-swinger).
 *
 * The Magnus force on a sphere is:
 *
 *   F_m = C_l · ρ · A · v² / 2 · (ω̂ × v̂)
 *
 * For a soccer ball (mass 0.43 kg, radius 0.11 m), at v = 25 m/s,
 * spin = 8 rev/s, the curl can shift the ball ~1.5 m laterally over a
 * 25 m flight. Phase 2 codes a constant scalar magnitude (max 0.8 m
 * lateral offset over flight) to keep tuning simple.
 */
import type { Vec3 } from "@vtorn/spec";

export type CurlDirection = "left" | "right" | "none" | "topspin" | "backspin";

export interface MagnusInputs {
  /** Kick direction (start → end, normalised). */
  travelDir: Vec3;
  /** World-up axis (default +Z, matching VTourn spec convention). */
  upAxis?: Vec3;
  /**
   * Curl flavour. `"left"` / `"right"` curl horizontally; `"topspin"`
   * adds a downward dip; `"backspin"` lifts the trajectory.
   */
  curl: CurlDirection;
  /**
   * Strength multiplier in [0, 1]. Phase-2 default 0.5 (≈ 0.4 m
   * lateral offset). Phase 4 will scale per-player or per-event.
   */
  strength?: number;
}

/** Cross product helper. */
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Normalise a Vec3, returning a zero vector if length is ~0. */
function normalise(v: Vec3): Vec3 {
  const m = Math.hypot(v[0], v[1], v[2]);
  if (m < 1e-9) return [0, 0, 0];
  return [v[0] / m, v[1] / m, v[2] / m];
}

/**
 * Compute the Magnus side-force vector for the configured curl.
 * Returns zeros if curl is `"none"`.
 *
 * The vector is *not* the physical force — it's the *peak lateral
 * offset* (in metres) that the spline mode applies at mid-flight. The
 * spline integrator multiplies by a bell-shape t(1−t)·4 so the offset
 * is zero at the kick and arrival.
 */
export function magnusSideForce(inputs: MagnusInputs): Vec3 {
  const strength = inputs.strength ?? 0.5;
  const upAxis = inputs.upAxis ?? [0, 0, 1];
  const dir = normalise(inputs.travelDir);
  const up = normalise(upAxis);

  switch (inputs.curl) {
    case "none":
      return [0, 0, 0];
    case "left": {
      // Lateral perpendicular to travel, in the horizontal plane.
      const side = normalise(cross(up, dir));
      return [side[0] * strength, side[1] * strength, side[2] * strength];
    }
    case "right": {
      const side = normalise(cross(dir, up));
      return [side[0] * strength, side[1] * strength, side[2] * strength];
    }
    case "topspin":
      // Pull the apex down — negative on the up-axis.
      return [-up[0] * strength * 0.6, -up[1] * strength * 0.6, -up[2] * strength * 0.6];
    case "backspin":
      // Lift the apex.
      return [up[0] * strength * 0.6, up[1] * strength * 0.6, up[2] * strength * 0.6];
  }
}

/**
 * Convenience: derive a curl direction from a shot's outcome flag and
 * the player's preferred foot. Phase 2 just returns "none" for
 * non-shot/free-kick events; Phase 4 will swap in real per-player
 * data.
 */
export function inferCurl(
  eventType: string,
  preferredFoot: "left" | "right" | "either" = "right",
): CurlDirection {
  if (eventType === "event.shot" || eventType === "event.pass") {
    // Right-footers tend to curl in-swinger from outside the foot.
    return preferredFoot === "left" ? "right" : "left";
  }
  if (eventType === "event.out_of_bounds") return "none";
  return "none";
}
