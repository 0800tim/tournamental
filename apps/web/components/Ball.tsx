"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { StoreApi } from "zustand/vanilla";
import type { MatchStore } from "@vtorn/spec-client";
import {
  alphaForNow,
  extrapolateBall,
  interpolateBall,
} from "@/lib/interpolation";
import { toWorldInto } from "@/lib/coords";

const STALE_THRESHOLD_MS = 200;

interface BallProps {
  store: StoreApi<MatchStore>;
}

/**
 * The ball: a small white sphere that lerps between StateFrames and
 * forward-extrapolates by velocity if the stream stalls (per doc 04).
 */
export function Ball({ store }: BallProps) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const tmp = useRef(new THREE.Vector3());

  useFrame(() => {
    const state = store.getState();
    if (!state.curr) return;

    const wallNow = Date.now();
    const alpha = alphaForNow(state.prevWallMs, state.currWallMs, wallNow);
    let ball = interpolateBall(state.prev, state.curr, alpha);
    if (!ball) return;

    const stale = wallNow - state.currWallMs;
    if (stale > STALE_THRESHOLD_MS) {
      ball = extrapolateBall(state.curr.ball, stale);
    }

    toWorldInto(tmp.current, ball.pos);
    if (meshRef.current) {
      meshRef.current.position.copy(tmp.current);
      meshRef.current.rotation.x += 0.1;
      meshRef.current.rotation.z += 0.07;
    }
  });

  return (
    <mesh ref={meshRef} castShadow>
      <sphereGeometry args={[0.22, 24, 16]} />
      <meshStandardMaterial color="#ffffff" roughness={0.5} />
    </mesh>
  );
}
