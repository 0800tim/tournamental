import { Vector3 } from "three";
import type { Vec2, Vec3 } from "@tournamental/spec";

/**
 * Spec coords are pitch-centred metres with +x along length, +y along width,
 * +z up. three.js convention is +y up. Mapping:
 *
 *   spec (x, y)     → three (x, 0, -y)
 *   spec (x, y, z)  → three (x, z, -y)
 *
 * The negation on y is so that "team 1's goal at +x" in spec lines up with
 * the +x axis in three.js when looking down the pitch from a broadcast camera
 * placed on +z (in spec) / +y (in three).
 *
 * This is the only place in the renderer that knows the spec's coordinate
 * convention. Every component takes Vector3 and is conventional three.js.
 */
export function toWorld(p: Vec2 | Vec3): Vector3 {
  if (p.length === 2) {
    return new Vector3(p[0], 0, -p[1]);
  }
  return new Vector3(p[0], p[2], -p[1]);
}

/**
 * In spec coords yaw=0 points +x and yaw=π/2 points +y. After the y-axis
 * negation above, +y(spec) maps to -z(three.js), so a yaw rotation around
 * the world +y axis (three.js) needs the sign flipped.
 */
export function toWorldYaw(yaw: number): number {
  return -yaw;
}

/**
 * In-place variant for tight render loops; reuses the supplied Vector3 to
 * avoid per-frame allocations. Preferred from `useFrame` callbacks.
 */
export function toWorldInto(out: Vector3, p: Vec2 | Vec3): Vector3 {
  if (p.length === 2) {
    out.set(p[0], 0, -p[1]);
  } else {
    out.set(p[0], p[2], -p[1]);
  }
  return out;
}
