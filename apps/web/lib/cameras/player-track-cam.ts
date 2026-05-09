/**
 * Player-track camera.
 *
 * Per `docs/27b-fidelity-phase2-physics-director.md`:
 *
 *   35mm FOV, 4 m behind player, looks over shoulder.
 *
 * Used for celebration follow-cam after a goal, and (later) penalty
 * walk-ups. Sits 4 m back of the player along their facing direction,
 * 1.8 m up, looking over their shoulder.
 */
import * as THREE from "three";
import type { CameraTarget } from "../director/director-policy.js";

export const PLAYER_TRACK_FOV = 60; // ≈35mm-equivalent
export const PLAYER_TRACK_BACK = 4;
export const PLAYER_TRACK_HEIGHT = 1.8;

export interface PlayerCamInputs {
  position: THREE.Vector3;
  /** Yaw in radians, world frame. */
  facing: number;
}

/**
 * Compute the player-track camera's desired pose.
 *
 * `player.facing` is the yaw the player is looking; the camera is
 * placed `PLAYER_TRACK_BACK` metres behind, raised
 * `PLAYER_TRACK_HEIGHT`, looking at the player.
 */
export function playerTrackCamera(player: PlayerCamInputs | null): CameraTarget {
  if (!player) {
    return {
      position: new THREE.Vector3(0, PLAYER_TRACK_HEIGHT, PLAYER_TRACK_BACK),
      lookAt: new THREE.Vector3(0, 1.7, 0),
      fov: PLAYER_TRACK_FOV,
      name: "player-track",
    };
  }
  const yaw = player.facing;
  const back = new THREE.Vector3(
    -Math.cos(yaw) * PLAYER_TRACK_BACK,
    0,
    -Math.sin(yaw) * PLAYER_TRACK_BACK,
  );
  const camPos = player.position.clone().add(back);
  camPos.y = (camPos.y || 0) + PLAYER_TRACK_HEIGHT;

  const lookAt = player.position.clone();
  lookAt.y = (lookAt.y || 0) + 1.7;

  return {
    position: camPos,
    lookAt,
    fov: PLAYER_TRACK_FOV,
    name: "player-track",
  };
}
