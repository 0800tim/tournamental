/**
 * Behind-goal camera.
 *
 * Per `docs/27b-fidelity-phase2-physics-director.md`:
 *
 *   50mm FOV, 8 m up, behind goal, looks at ball.
 *
 * "Behind goal" means: pick the goal nearer to the ball's X
 * coordinate (in spec coords, +X is one team's goal-line). The camera
 * sits 8 m up and ~6 m past the goal-line, looking back into the
 * pitch toward the ball.
 */
import * as THREE from "three";
import type { CameraTarget } from "../director/director-policy.js";

export const BEHIND_GOAL_FOV = 35; // ≈50mm-equivalent
export const BEHIND_GOAL_HEIGHT = 8;
export const BEHIND_GOAL_BACK = 6; // metres past the goal line

/**
 * Compute the behind-goal camera's desired pose.
 *
 * `ballWorld` selects which goal to sit behind: ball.x > 0 → camera
 * behind the +X goal; ball.x < 0 → camera behind the -X goal. With
 * pitch length conventionally 105 m, the goal-line is ~52.5 m.
 *
 * `pitchLength` defaults to 105 (FIFA standard); the renderer can
 * override per-match.
 */
export function behindGoalCamera(
  ballWorld: THREE.Vector3 | null,
  pitchLength = 105,
): CameraTarget {
  const half = pitchLength / 2;
  const sign = ballWorld ? Math.sign(ballWorld.x) || 1 : 1;
  const goalX = sign * (half + BEHIND_GOAL_BACK);

  // Look at the ball position (or pitch centre as a fallback).
  const target = ballWorld
    ? ballWorld.clone()
    : new THREE.Vector3(0, 0, 0);

  return {
    position: new THREE.Vector3(goalX, BEHIND_GOAL_HEIGHT, target.z),
    lookAt: target,
    fov: BEHIND_GOAL_FOV,
    name: "behind-goal",
  };
}
