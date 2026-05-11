/**
 * Broadcast camera, wide tracking shot (default).
 *
 * Per `docs/27b-fidelity-phase2-physics-director.md` (re-tuned 2026-05
 * for Tim's lighting + camera-angle review):
 *
 *   ≈85mm-equiv FOV (36°), 22 m above pitch, 50 m back from pitch
 *   centre. Tracks the ball's X with half-damping so it never leads
 *   the ball or jitters on a state-frame stutter, and aims its lookAt
 *   a metre above the pitch so the player heads (~1.8 m tall) sit
 *   roughly centred in frame instead of the camera tilting downward
 *   to a pitch-floor target.
 *
 * Tighter FOV vs. the previous 50° gives a broadcast-style "long
 * lens" feel that better hides the simple geometry and keeps the
 * stadium silhouette out of the frame edges.
 */
import * as THREE from "three";
import type { CameraTarget } from "../director/director-policy.js";

export const BROADCAST_FOV = 36;
export const BROADCAST_HEIGHT = 22;
export const BROADCAST_DEPTH = 50;
/** Aim slightly above the pitch so player heads (~1.8 m) sit centred. */
export const BROADCAST_LOOK_HEIGHT = 1.5;

/**
 * Compute the broadcast camera's desired (position, lookAt) given the
 * current ball world position. Pure function, easy to unit-test.
 */
export function broadcastCamera(ballWorld: THREE.Vector3 | null): CameraTarget {
  // Tighter X clamp than the old [-30, 30] so the camera doesn't swing
  // alarmingly when play breaks down the wing. Half-damped via the
  // *0.5 below, the X follow lags but stays anchored to the play.
  const tx = ballWorld ? THREE.MathUtils.clamp(ballWorld.x, -25, 25) : 0;
  const targetX = ballWorld ? ballWorld.x * 0.5 : 0;
  const targetZ = ballWorld ? ballWorld.z * 0.35 : 0;

  return {
    position: new THREE.Vector3(tx * 0.5, BROADCAST_HEIGHT, BROADCAST_DEPTH),
    lookAt: new THREE.Vector3(targetX, BROADCAST_LOOK_HEIGHT, targetZ),
    fov: BROADCAST_FOV,
    name: "broadcast",
  };
}
