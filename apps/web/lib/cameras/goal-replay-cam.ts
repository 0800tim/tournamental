/**
 * Goal-replay camera.
 *
 * Per `docs/27b-fidelity-phase2-physics-director.md`:
 *
 *   0.25× speed, vignette 0.6, motion blur up.
 *
 * The replay camera sits low (3 m up) and slightly to the side of
 * the goal-mouth, looking at the ball — the broadcast cliché. It also
 * exposes its post-FX intensity so `<Director>` can drive the
 * vignette / motion-blur stack (Phase 3 wires the actual passes).
 */
import * as THREE from "three";
import type { CameraTarget } from "../director/director-policy.js";

export const GOAL_REPLAY_FOV = 38;
export const GOAL_REPLAY_HEIGHT = 3;
export const GOAL_REPLAY_BACK = 9;
export const GOAL_REPLAY_OFFSET = 5;
/** Replay timeline rate: 0.25 = quarter-speed slow-mo. */
export const GOAL_REPLAY_RATE = 0.25;
/** Replay window: how many seconds *before* the goal we cut to. */
export const GOAL_REPLAY_PRE_SEC = 4;
/** Total replay-cam dwell time on screen (seconds, real-time). */
export const GOAL_REPLAY_DWELL_SEC = 4;

/**
 * Compute the goal-replay camera's pose.
 *
 *   `ballWorld` — the ball's position at the moment of the goal.
 *
 * Camera sits behind+offset from the goal-line, looking back at the
 * ball.
 */
export function goalReplayCamera(
  ballWorld: THREE.Vector3 | null,
  pitchLength = 105,
): CameraTarget {
  const half = pitchLength / 2;
  const sign = ballWorld ? Math.sign(ballWorld.x) || 1 : 1;
  const goalX = sign * (half + GOAL_REPLAY_BACK);

  const target = ballWorld
    ? ballWorld.clone()
    : new THREE.Vector3(0, 0, 0);

  return {
    position: new THREE.Vector3(goalX, GOAL_REPLAY_HEIGHT, GOAL_REPLAY_OFFSET),
    lookAt: target,
    fov: GOAL_REPLAY_FOV,
    name: "goal-replay",
    /** Phase 3 will read these to drive post-FX. */
    fx: { vignette: 0.6, motionBlur: 1.0, slowMoRate: GOAL_REPLAY_RATE },
  };
}
