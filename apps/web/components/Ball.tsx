"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { StoreApi } from "zustand/vanilla";
import type { EventMessage } from "@vtorn/spec";
import type { MatchStore } from "@vtorn/spec-client";
import {
  BallController,
  VerletBall,
  BALL_CONSTANTS,
} from "@vtorn/ball-physics";
import {
  alphaForNow,
  extrapolateBall,
  interpolateBall,
} from "@/lib/interpolation";
import { toWorldInto } from "@/lib/coords";
import { useSceneBuffer } from "@/lib/replay/buffer-context";

const STALE_THRESHOLD_MS = 200;

interface BallProps {
  store: StoreApi<MatchStore>;
}

/**
 * The ball.
 *
 * Per `docs/27b-fidelity-phase2-physics-director.md` § "Ball physics":
 *
 *   - Default mode is **spline**: the controller pipes through the
 *     spec stream's interpolated `BallState.pos` (cheap, deterministic).
 *   - On `Free Kick` / `corner` events, the controller switches to
 *     **rapier** mode and lets a physics integrator drive the ball
 *     for up to 2 s, then snaps back to spline.
 *
 * The Rapier integration uses `@vtorn/ball-physics`'s `VerletBall`
 * fallback for now (per the spec's substitution clause): the
 * `@react-three/rapier` v2.x peer chain requires R3F 9 / React 19,
 * which conflicts with the renderer's R3F 8 / React 18 stack inherited
 * from Phase 1. The fallback ships the same `BallPhysicsAPI` so
 * upgrading to a real `<RigidBody>` later is a one-day swap.
 */
export function Ball({ store }: BallProps) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const tmp = useRef(new THREE.Vector3());
  const lastEventIdx = useRef(0);
  const sceneBuffer = useSceneBuffer();

  const controller = useMemo(
    () => new BallController(new VerletBall()),
    [],
  );
  useEffect(() => () => void controller, [controller]);

  useFrame((_state, deltaRaw) => {
    const state = store.getState();
    if (!state.curr) return;

    // Clamp delta to avoid huge integration steps in the physics
    // controller after a tab-switch / GC stall.
    const delta = Math.min(deltaRaw, 1 / 30);

    // Resolve interpolated ball state. Prefer the shared scene buffer
    // (Catmull-Rom across 4 frames where available; linear otherwise);
    // fall back to the legacy alpha-per-arrival path so direct mounts
    // / unit harnesses without a buffer continue to work.
    let ball;
    if (sceneBuffer && sceneBuffer.size() >= 2) {
      const sample = sceneBuffer.sample();
      ball = sample?.ball ?? null;
    } else {
      const wallNow = Date.now();
      const alpha = alphaForNow(state.prevWallMs, state.currWallMs, wallNow);
      ball = interpolateBall(state.prev, state.curr, alpha);
    }
    if (!ball) return;

    const wallNow = Date.now();
    const stale = wallNow - state.currWallMs;
    if (stale > STALE_THRESHOLD_MS) {
      ball = extrapolateBall(state.curr.ball, stale);
    }

    // Take any new event into account (latest only — the controller
    // makes its mode decision based on the most recent ball-relevant
    // event).
    const events = state.events;
    let event: EventMessage | null = null;
    if (events.length > lastEventIdx.current) {
      event = events[events.length - 1] as EventMessage;
      lastEventIdx.current = events.length;
    }

    const splinePose = {
      pos: ball.pos,
      vel: ball.vel ?? [0, 0, 0],
    };
    const pose = controller.step(delta, event, splinePose);

    toWorldInto(tmp.current, pose.pos);
    if (meshRef.current) {
      meshRef.current.position.copy(tmp.current);
      const speed = Math.hypot(pose.vel[0], pose.vel[1]);
      const spin = Math.min(0.4, speed * 0.02);
      meshRef.current.rotation.x += 0.08 + spin;
      meshRef.current.rotation.z += 0.06;
    }
  });

  // Real ball radius is 0.11 m which reads as a barely-visible dot
  // from broadcast cameras. Render at 4x so the ball is clearly trackable.
  // (The ball's spec position is still in real-world coords; only the
  // visual sphere is scaled. Other consumers — physics, AABB tests —
  // stick with BALL_CONSTANTS.radius.)
  const VISUAL_RADIUS = BALL_CONSTANTS.radius * 4;
  return (
    <mesh ref={meshRef} castShadow>
      <sphereGeometry args={[VISUAL_RADIUS, 24, 16]} />
      <meshStandardMaterial
        color="#ffffff"
        emissive="#ffffff"
        emissiveIntensity={0.35}
        roughness={0.35}
        metalness={0}
      />
    </mesh>
  );
}
