"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { StoreApi } from "zustand/vanilla";
import type { EventMessage, Vec2 } from "@vtorn/spec";
import type { MatchStore } from "@vtorn/spec-client";
import {
  alphaForNow,
  interpolateBall,
  interpolatePlayer,
  findPlayer,
} from "@/lib/interpolation";
import { toWorld, toWorldYaw } from "@/lib/coords";
import {
  DirectorPolicy,
  type CameraTarget,
  type DirectorCamName,
} from "@/lib/director/director-policy";
import { CutBlender } from "@/lib/director/cut-blender";
import { ReplayBuffer } from "@/lib/director/replay-buffer";
import { broadcastCamera } from "@/lib/cameras/broadcast-cam";
import { behindGoalCamera } from "@/lib/cameras/behind-goal-cam";
import { playerTrackCamera } from "@/lib/cameras/player-track-cam";
import { goalReplayCamera } from "@/lib/cameras/goal-replay-cam";
import { crowdEnergyBus } from "@/lib/crowd-energy";

interface DirectorProps {
  store: StoreApi<MatchStore>;
  /** When `true` the director is active (auto-cut on goals). */
  enabled?: boolean;
}

/**
 * Auto-director — watches the event stream and drives the active
 * camera. Per `docs/27b-fidelity-phase2-physics-director.md`:
 *
 *   - 4 virtual cameras: broadcast / behind-goal / player-track /
 *     goal-replay.
 *   - On `Goal`: pause live → record last 8s into a circular buffer,
 *     cut to goal-replay at 0.25× speed, after 4s switch to
 *     player-track on the scorer for 5s, then ease back to broadcast.
 *   - Cuts are 200-400ms cosine-eased on position+lookAt; goal-replay
 *     is instant.
 *
 * The director owns:
 *
 *   1. A `DirectorPolicy` (FSM that picks the cam name).
 *   2. A `CutBlender` (eases position + lookAt across cuts).
 *   3. A `ReplayBuffer` (last 10s of player+ball positions at 60Hz).
 *
 * It uses the existing `useThree()` camera as the on-screen camera —
 * we don't mount a second `<PerspectiveCamera>` because the existing
 * `<CameraRig>` already drives the same camera. To avoid two systems
 * fighting, the director takes priority when `enabled` is true and
 * `<CameraRig>` no-ops in that case (handled in `MatchScene.tsx`).
 *
 * NOTE FOR PHASE 3: when the post-FX stack lands, the director will
 * also drive the vignette + motion-blur shaders during goal-replay
 * (see `goalReplayCamera()` `fx` field). For now those values are
 * exposed but no-ops.
 */
export function Director({ store, enabled = true }: DirectorProps) {
  const { camera } = useThree();
  const policyRef = useRef<DirectorPolicy | null>(null);
  const blenderRef = useRef<CutBlender | null>(null);
  const replayRef = useRef<ReplayBuffer | null>(null);
  const lastEventIdx = useRef(0);
  const tmpBall = useRef(new THREE.Vector3());
  const evalOut = useMemo(
    () => ({
      position: new THREE.Vector3(),
      lookAt: new THREE.Vector3(),
      fov: 50,
      name: "broadcast" as DirectorCamName,
    }),
    [],
  );

  // Build the policy + blender + buffer once on mount.
  useEffect(() => {
    policyRef.current = new DirectorPolicy({});
    blenderRef.current = new CutBlender({ blendSec: 0.3 });
    replayRef.current = new ReplayBuffer({ durationSec: 10, rateHz: 60 });
    return () => {
      policyRef.current = null;
      blenderRef.current = null;
      replayRef.current = null;
    };
  }, []);

  useFrame(() => {
    if (!enabled) return;
    const policy = policyRef.current;
    const blender = blenderRef.current;
    const buffer = replayRef.current;
    if (!policy || !blender || !buffer) return;

    const state = store.getState();
    const wallNow = Date.now();
    const sceneNow = performance.now();

    // 1. Buffer the latest pose at ~ 60 Hz (one push per frame; the
    // ring buffer caps the duration window automatically).
    if (state.curr) {
      const alpha = alphaForNow(state.prevWallMs, state.currWallMs, wallNow);
      const ball = interpolateBall(state.prev, state.curr, alpha);
      const players = state.curr.players.map((p) => {
        const interp = interpolatePlayer(state.prev, state.curr, p.id, alpha);
        return {
          id: p.id,
          pos: (interp ? interp.pos : p.pos) as Vec2,
          facing: interp ? interp.facing : p.facing,
        };
      });
      buffer.push({
        t: sceneNow,
        ball: ball ? ball.pos : state.curr.ball.pos,
        players,
      });
    }

    // 2. Feed any new events into the policy. Phase-3 also pulses
    //    the crowd-energy bus on impactful events so `<Crowd />` can
    //    react with bigger bobs / colour shifts.
    const events = state.events;
    if (events.length > lastEventIdx.current) {
      const newEvents = events.slice(lastEventIdx.current) as EventMessage[];
      lastEventIdx.current = events.length;
      for (const ev of newEvents) {
        policy.consume(ev);
        if (ev.type === "event.goal") crowdEnergyBus.pulse("goal");
        else if (ev.type === "event.tackle" || ev.type === "event.foul")
          crowdEnergyBus.pulse("tackle");
      }
    }

    // 3. Tick the policy → active cam name.
    const camName = policy.tick();

    // 4. Compute the target pose for the active cam.
    const ballState = state.curr ? state.curr.ball : null;
    if (ballState) toWorld(ballState.pos);
    const ballWorld = ballState
      ? tmpBall.current.set(ballState.pos[0], ballState.pos[2], -ballState.pos[1])
      : null;

    let target: CameraTarget;
    switch (camName) {
      case "broadcast":
        target = broadcastCamera(ballWorld);
        break;
      case "behind-goal":
        target = behindGoalCamera(ballWorld);
        break;
      case "goal-replay":
        target = goalReplayCamera(ballWorld);
        break;
      case "player-track": {
        const scorerId = policy.scorerId();
        const player = scorerId && state.curr ? findPlayer(state.curr, scorerId) : null;
        if (player) {
          const playerWorld = toWorld(player.pos);
          target = playerTrackCamera({
            position: playerWorld,
            facing: toWorldYaw(player.facing),
          });
        } else {
          target = broadcastCamera(ballWorld);
        }
        break;
      }
    }

    // 5. Drive the cut blender → write to the active camera.
    blender.setTarget(target);
    blender.evaluate(evalOut);

    if (camera instanceof THREE.PerspectiveCamera) {
      const fovChanged = Math.abs(camera.fov - evalOut.fov) > 0.1;
      if (fovChanged) {
        camera.fov = evalOut.fov;
        camera.updateProjectionMatrix();
      }
    }
    camera.position.copy(evalOut.position);
    camera.lookAt(evalOut.lookAt);

    // 6. (Phase 3 hookup) Expose the post-FX intensities + slow-mo
    //    rate on the camera's userData. Phase 3 wires this into the
    //    post-processing stack + the manifest controller's clock-rate.
    camera.userData.directorCam = camName;
    camera.userData.slowMoRate = policy.slowMoRate();
    camera.userData.fx = target.fx ?? null;
  });

  return null;
}
