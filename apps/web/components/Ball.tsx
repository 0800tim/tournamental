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

  const controller = useMemo(
    () => new BallController(new VerletBall()),
    [],
  );
  useEffect(() => () => void controller, [controller]);

  useFrame((_state, delta) => {
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

  return (
    <mesh ref={meshRef} castShadow>
      <sphereGeometry args={[BALL_CONSTANTS.radius, 24, 16]} />
      <meshStandardMaterial color="#ffffff" roughness={0.5} />
    </mesh>
  );
}
