/**
 * Broadcast camera — wide tracking shot (default).
 *
 * Per `docs/27b-fidelity-phase2-physics-director.md`:
 *
 *   70mm equiv FOV, 25 m above pitch level, follows ball x with damping.
 *
 * The camera lives 25 m above and ~55 m back from pitch centre,
 * tracking the ball's X with 50% damping so it can never lead the
 * ball or jitter on a state-frame stutter.
 */
import * as THREE from "three";
import type { CameraTarget } from "../director/director-policy.js";

export const BROADCAST_FOV = 50; // ≈70mm-equivalent on a 35mm sensor
export const BROADCAST_HEIGHT = 25;
export const BROADCAST_DEPTH = 55;

/**
 * Compute the broadcast camera's desired (position, lookAt) given the
 * current ball world position. Pure function — easy to unit-test.
 */
export function broadcastCamera(ballWorld: THREE.Vector3 | null): CameraTarget {
  const tx = ballWorld
    ? THREE.MathUtils.clamp(ballWorld.x, -30, 30)
    : 0;
  const targetX = ballWorld ? ballWorld.x * 0.4 : 0;
  const targetZ = ballWorld ? ballWorld.z * 0.4 : 0;

  return {
    position: new THREE.Vector3(tx * 0.5, BROADCAST_HEIGHT, BROADCAST_DEPTH),
    lookAt: new THREE.Vector3(targetX, 0, targetZ),
    fov: BROADCAST_FOV,
    name: "broadcast",
  };
}
