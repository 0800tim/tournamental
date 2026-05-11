"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { StoreApi } from "zustand/vanilla";
import type { EventMessage, PlayerState, Vec2 } from "@tournamental/spec";
import type { MatchStore } from "@tournamental/spec-client";
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
import { DampedCameraDriver } from "@/lib/cameras/damped-driver";
import { crowdEnergyBus } from "@/lib/crowd-energy";
import { replayHudBus } from "@/lib/director/replay-hud-bus";
import { useSceneBuffer } from "@/lib/replay/buffer-context";

interface DirectorProps {
  store: StoreApi<MatchStore>;
  /** When `true` the director is active (auto-cut on goals). */
  enabled?: boolean;
}

/**
 * Auto-director, watches the event stream and drives the active
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
 * It uses the existing `useThree()` camera as the on-screen camera -
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
  const damperRef = useRef<DampedCameraDriver | null>(null);
  const lastEventIdx = useRef(0);
  const lastCamName = useRef<DirectorCamName | null>(null);
  const tmpBall = useRef(new THREE.Vector3());
  const sceneBuffer = useSceneBuffer();
  const evalOut = useMemo(
    () => ({
      position: new THREE.Vector3(),
      lookAt: new THREE.Vector3(),
      fov: 50,
      name: "broadcast" as DirectorCamName,
    }),
    [],
  );

  // Build the policy + blender + buffer + damper once on mount.
  useEffect(() => {
    policyRef.current = new DirectorPolicy({});
    blenderRef.current = new CutBlender({ blendSec: 0.3 });
    replayRef.current = new ReplayBuffer({ durationSec: 10, rateHz: 60 });
    damperRef.current = new DampedCameraDriver({
      positionLambda: 5,
      lookAtLambda: 4,
      fovLambda: 6,
    });
    return () => {
      policyRef.current = null;
      blenderRef.current = null;
      replayRef.current = null;
      damperRef.current = null;
    };
  }, []);

  useFrame((_threeState, dtRaw) => {
    if (!enabled) return;
    const policy = policyRef.current;
    const blender = blenderRef.current;
    const buffer = replayRef.current;
    const damper = damperRef.current;
    if (!policy || !blender || !buffer || !damper) return;

    // Clamp delta to avoid frame-stall snaps in any downstream maths.
    const dt = Math.min(dtRaw, 1 / 30);

    const state = store.getState();
    const sceneNow = performance.now();

    // 1. Buffer the latest pose at ~ 60 Hz (one push per frame; the
    // ring buffer caps the duration window automatically). Sample from
    // the shared StateFrameBuffer so the replay buffer (used for
    // post-goal slow-mo cuts) gets *interpolated* poses, not the raw
    // burst-batched store frames.
    if (state.curr) {
      let ballPos: [number, number, number] = state.curr.ball.pos;
      let players: { id: string; pos: Vec2; facing: number }[];
      if (sceneBuffer && sceneBuffer.size() >= 2) {
        const sample = sceneBuffer.sample();
        if (sample) {
          ballPos = sample.ball.pos;
          players = sample.players.map((p) => ({
            id: p.id,
            pos: p.pos,
            facing: p.facing,
          }));
        } else {
          players = state.curr.players.map((p) => ({
            id: p.id,
            pos: p.pos as Vec2,
            facing: p.facing,
          }));
        }
      } else {
        players = state.curr.players.map((p) => ({
          id: p.id,
          pos: p.pos as Vec2,
          facing: p.facing,
        }));
      }
      buffer.push({ t: sceneNow, ball: ballPos, players });
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

    // 4. Compute the target pose for the active cam. Read pose from
    //    the shared scene buffer (smoothed) when available so a moving
    //    target doesn't snap.
    const sample = sceneBuffer ? sceneBuffer.sample() : null;
    const ballPos = sample ? sample.ball.pos : state.curr ? state.curr.ball.pos : null;
    const ballWorld = ballPos
      ? tmpBall.current.set(ballPos[0], ballPos[2], -ballPos[1])
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
        // Prefer the smoothed sample's player; fall back to the raw store.
        let player: PlayerState | null = null;
        if (scorerId && sample) {
          player = sample.players.find((p) => p.id === scorerId) ?? null;
        }
        if (!player && scorerId && state.curr) {
          player = state.curr.players.find((p) => p.id === scorerId) ?? null;
        }
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

    // 5. Drive the cut blender → damped write to the active camera.
    blender.setTarget(target);
    blender.evaluate(evalOut);

    // On a cut to a new cam, force the damper to snap so we don't
    // "slide" between cameras. The cut-blender's intra-segment ease
    // already provides a 200-400 ms cosine transition for the
    // *target*; the damper just smooths *target movement* within a
    // single cam.
    if (lastCamName.current !== evalOut.name) {
      damper.reset();
      lastCamName.current = evalOut.name;
    }
    // Enforce world-up before lookAt() inside the damper. Tim's review
    // flagged a banked horizon on follow-ball; pinning camera.up here
    // means three.js can't pick an off-axis basis on lookAt.
    camera.up.set(0, 1, 0);
    damper.update(camera as THREE.PerspectiveCamera, evalOut, dt);

    // 6. (Phase 3 hookup) Expose the post-FX intensities + slow-mo
    //    rate on the camera's userData. Phase 3 wires this into the
    //    post-processing stack + the manifest controller's clock-rate.
    camera.userData.directorCam = camName;
    camera.userData.slowMoRate = policy.slowMoRate();
    camera.userData.fx = target.fx ?? null;

    // Phase-4: publish to replay-HUD bus for the DOM-side overlay.
    const scorerId = policy.scorerId();
    let scorerName: string | null = null;
    let scorerTeam: string | null = null;
    let goalAtMatchSec = 0;
    if (scorerId && state.init) {
      for (const team of state.init.teams) {
        const found = team.players.find((p) => p.id === scorerId);
        if (found) {
          scorerName = found.name;
          scorerTeam = team.short_name ?? team.name;
          break;
        }
      }
      const phase = policy.getPhase();
      if (phase.kind === "goal-sequence") {
        goalAtMatchSec = phase.goalEventTime / 1000;
      }
    }
    replayHudBus.publish({
      cam: camName,
      slowMoRate: policy.slowMoRate(),
      secsSinceCut: policy.secsSinceCut(),
      scorerId: scorerId ?? null,
      scorerName,
      scorerTeam,
      goalAtMatchSec,
      scoreHome: state.score?.home ?? 0,
      scoreAway: state.score?.away ?? 0,
    });
  });

  return null;
}
