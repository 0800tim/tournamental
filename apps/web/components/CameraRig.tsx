"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { StoreApi } from "zustand/vanilla";
import type { MatchStore } from "@vtorn/spec-client";
import { interpolateBall, alphaForNow } from "@/lib/interpolation";
import { toWorld } from "@/lib/coords";
import { useSceneBuffer } from "@/lib/replay/buffer-context";
import { DampedCameraDriver } from "@/lib/cameras/damped-driver";

export type CameraMode = "broadcast" | "tactical" | "follow" | "director";

interface CameraRigProps {
  store: StoreApi<MatchStore>;
  mode: CameraMode;
}

/**
 * Damped camera rig. Three modes:
 *
 *   broadcast  Tracks ball with a smoothed offset; main TV-camera vibe.
 *   tactical   Top-down ortho, plan view of the whole pitch.
 *   follow     Closer / lower follow-cam for short clips.
 *
 * Implementation: each frame we compute a desired (position, target) and
 * lerp the camera toward it with a fixed damping factor. Doc 04 calls for
 * "regular three.js camera + damped lerp on a target derived from the
 * lerped ball position" — that's exactly this.
 */
export function CameraRig({ store, mode }: CameraRigProps) {
  const { camera } = useThree();
  const desiredPos = useRef(new THREE.Vector3());
  const desiredTarget = useRef(new THREE.Vector3());
  const sceneBuffer = useSceneBuffer();
  const driver = useMemo(
    () =>
      new DampedCameraDriver({
        positionLambda: 5,
        lookAtLambda: 4,
        fovLambda: 6,
      }),
    [],
  );
  const fov = useRef(45);

  useEffect(() => {
    // Snap camera to the new mode's pose immediately.
    if (mode === "tactical") {
      camera.position.set(0, 95, 0.001);
    } else if (mode === "follow") {
      // Stable "behind-and-above" anchor; matches the follow preset
      // computed in useFrame below.
      camera.position.set(0, 12, 28);
    } else {
      camera.position.set(0, 22, 50);
    }
    // Always enforce camera up-vector = world up. Some R3F internals
    // tweak `camera.up` when interacting with controls; clamping it
    // here means follow-ball can't end up banked / rolled (Tim's
    // screenshots showed a rolled horizon).
    camera.up.set(0, 1, 0);
    driver.reset();
  }, [mode, camera, driver]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 1 / 30);
    const state = store.getState();

    let ballPos: [number, number, number] | null = null;
    if (sceneBuffer && sceneBuffer.size() >= 2) {
      const sample = sceneBuffer.sample();
      ballPos = sample?.ball.pos ?? null;
    }
    if (!ballPos) {
      const wallNow = Date.now();
      const alpha = alphaForNow(state.prevWallMs, state.currWallMs, wallNow);
      const ball = interpolateBall(state.prev, state.curr, alpha);
      ballPos = ball ? ball.pos : null;
    }
    const target = ballPos ? toWorld(ballPos) : new THREE.Vector3(0, 0, 0);

    switch (mode) {
      case "tactical":
        // Pure top-down ~95 m up. Slight +z offset keeps the matrix
        // non-singular so the lookAt doesn't flip the camera-up vector.
        desiredPos.current.set(0, 95, 0.001);
        desiredTarget.current.set(0, 0, 0);
        fov.current = 45;
        break;
      case "follow": {
        // Stable behind-and-above shot. Anchored at a fixed offset in
        // world space (+Z behind the play looking toward -Z / pitch) so
        // the camera doesn't bank when the ball pivots. Height 12 m,
        // 28 m behind. lookAt aimed slightly above the ball so it
        // doesn't sit at the bottom of the frame.
        desiredPos.current.set(target.x, 12, target.z + 28);
        desiredTarget.current.set(target.x, 2, target.z);
        fov.current = 36;
        break;
      }
      case "broadcast":
      default: {
        // Camera sits above and behind, slightly tracking the ball's x.
        // Tightened from the old 50° / 25 m / 55 m setup so the
        // stadium silhouette doesn't dominate the frame edges. Look-
        // height raised above pitch-floor so player heads sit centred.
        const tx = THREE.MathUtils.clamp(target.x, -25, 25);
        desiredPos.current.set(tx * 0.5, 22, 50);
        desiredTarget.current.set(target.x * 0.5, 1.5, target.z * 0.35);
        fov.current = 36;
        break;
      }
    }

    // Re-assert world-up every frame — the lookAt() call in the damper
    // computes orientation off `camera.up`, so any drift there shows
    // up as horizon roll. Belt-and-braces against the tilted-horizon
    // Tim saw on follow-ball.
    camera.up.set(0, 1, 0);

    driver.update(
      camera as THREE.PerspectiveCamera,
      {
        position: desiredPos.current,
        lookAt: desiredTarget.current,
        fov: fov.current,
      },
      dt,
    );
  });

  return null;
}
