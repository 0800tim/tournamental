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
      camera.position.set(0, 80, 0);
    } else if (mode === "follow") {
      camera.position.set(0, 6, 18);
    } else {
      camera.position.set(0, 25, 60);
    }
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
        desiredPos.current.set(0, 80, 0.001);
        desiredTarget.current.set(0, 0, 0);
        break;
      case "follow":
        desiredPos.current.set(target.x - 8, 5, target.z + 12);
        desiredTarget.current.copy(target);
        break;
      case "broadcast":
      default: {
        // Camera sits above and behind, slightly tracking the ball's x.
        const tx = THREE.MathUtils.clamp(target.x, -30, 30);
        desiredPos.current.set(tx * 0.5, 22, 55);
        desiredTarget.current.set(target.x * 0.4, 0, target.z * 0.4);
        break;
      }
    }

    if (camera instanceof THREE.PerspectiveCamera) fov.current = camera.fov;
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
