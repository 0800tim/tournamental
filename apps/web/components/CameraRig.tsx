"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { StoreApi } from "zustand/vanilla";
import type { MatchStore } from "@vtorn/spec-client";
import { interpolateBall, alphaForNow } from "@/lib/interpolation";
import { toWorld } from "@/lib/coords";

export type CameraMode = "broadcast" | "tactical" | "follow";

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
  const lookAt = useRef(new THREE.Vector3());
  const desiredPos = useRef(new THREE.Vector3());
  const desiredTarget = useRef(new THREE.Vector3());

  useEffect(() => {
    if (mode === "tactical") {
      camera.position.set(0, 80, 0);
    } else if (mode === "follow") {
      camera.position.set(0, 6, 18);
    } else {
      camera.position.set(0, 25, 60);
    }
  }, [mode, camera]);

  useFrame((_, dt) => {
    const state = store.getState();
    const wallNow = Date.now();
    const alpha = alphaForNow(state.prevWallMs, state.currWallMs, wallNow);
    const ball = interpolateBall(state.prev, state.curr, alpha);
    const target = ball ? toWorld(ball.pos) : new THREE.Vector3(0, 0, 0);

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

    const damping = mode === "tactical" ? 1 : Math.min(1, dt * 4);
    camera.position.lerp(desiredPos.current, damping);
    lookAt.current.lerp(desiredTarget.current, damping);
    camera.lookAt(lookAt.current);
  });

  return null;
}
