"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Billboard, Text } from "@react-three/drei";
import type { StoreApi } from "zustand/vanilla";
import type { Kit, Player as SpecPlayer } from "@vtorn/spec";
import type { MatchStore } from "@vtorn/spec-client";
import {
  alphaForNow,
  estimateSpeed,
  interpolatePlayer,
} from "@/lib/interpolation";
import { stepFsm, INITIAL_FSM_STATE, activeTag, type FsmState } from "@/lib/animation-fsm";
import { toWorldInto, toWorldYaw } from "@/lib/coords";
import { makeJerseyTexture } from "@/lib/jersey-texture";

interface PlayerProps {
  player: SpecPlayer;
  team: "home" | "away";
  kit: Kit;
  store: StoreApi<MatchStore>;
}

/**
 * Procedural-billboard player avatar (doc 07 tier 3, simplified for v0.1).
 *
 *   - Capsule body, scaled torso/legs that lean forward in run/sprint.
 *   - Jersey colour from the team kit; jersey number on the torso plane.
 *   - Nameplate billboard above the head.
 *   - Position/rotation updated every frame via refs (no React re-renders).
 *
 * When `@vtorn/avatar` lands, swap the body group for their <AvatarBody/>
 * mesh — the position/rotation code below stays identical.
 */
export function Player({ player, team, kit, store }: PlayerProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const torsoRef = useRef<THREE.Mesh>(null!);
  const legsRef = useRef<THREE.Group>(null!);
  const isGK = player.position === "GK";

  const jerseyTexture = useMemo(() => makeJerseyTexture(kit, player.number, isGK), [kit, player.number, isGK]);

  const fsm = useRef<FsmState>({ ...INITIAL_FSM_STATE });
  const lastEventIdx = useRef(0);
  const tmpVec = useRef(new THREE.Vector3());

  useFrame(() => {
    const state = store.getState();
    if (!state.curr) return;

    const now = performance.now();
    const wallNow = Date.now();
    const alpha = alphaForNow(state.prevWallMs, state.currWallMs, wallNow);
    const interp = interpolatePlayer(state.prev, state.curr, player.id, alpha);
    if (!interp) return;

    toWorldInto(tmpVec.current, interp.pos);
    if (groupRef.current) {
      groupRef.current.position.copy(tmpVec.current);
      groupRef.current.rotation.y = toWorldYaw(interp.facing);
    }

    // Animation FSM step.
    const speed = estimateSpeed(state.prev, state.curr, player.id);
    const events = state.events;
    const newEvents = events.slice(lastEventIdx.current);
    lastEventIdx.current = events.length;
    fsm.current = stepFsm(fsm.current, speed, newEvents, player.id, now);

    const tag = activeTag(fsm.current, now);

    // Visualise the FSM tag with cheap procedural motion: torso lean +
    // leg swing scale by speed, big shoot/celebrate offsets.
    if (torsoRef.current && legsRef.current) {
      let lean = 0;
      let bob = 0;
      let armRaise = 0;
      switch (tag) {
        case "idle":
          bob = Math.sin(now * 0.003) * 0.02;
          break;
        case "walk":
          lean = 0.08;
          bob = Math.sin(now * 0.012) * 0.05;
          break;
        case "run":
          lean = 0.18;
          bob = Math.sin(now * 0.02) * 0.07;
          break;
        case "sprint":
          lean = 0.28;
          bob = Math.sin(now * 0.028) * 0.09;
          break;
        case "shoot":
        case "kick":
          lean = 0.35;
          bob = 0;
          break;
        case "tackle":
          lean = 0.5;
          bob = -0.1;
          break;
        case "fall":
          lean = 1.2;
          bob = -0.3;
          break;
        case "celebrate":
          lean = -0.2;
          bob = Math.abs(Math.sin(now * 0.02)) * 0.3;
          armRaise = 0.6;
          break;
        default:
          break;
      }
      torsoRef.current.rotation.x = lean;
      torsoRef.current.position.y = 0.85 + bob;
      legsRef.current.rotation.x = -lean * 0.6;
      // Use scale.y on legs to fake stride for run/sprint (visually noticeable).
      const stride = tag === "sprint" ? 1.0 + Math.sin(now * 0.03) * 0.25 : tag === "run" ? 1.0 + Math.sin(now * 0.022) * 0.15 : 1.0;
      legsRef.current.scale.y = stride;

      // Arm raise for celebrate.
      if (groupRef.current.userData.armRaise !== armRaise) {
        groupRef.current.userData.armRaise = armRaise;
      }
    }
  });

  const teamTint = team === "home" ? kit.primary : kit.primary;

  return (
    <group ref={groupRef}>
      {/* Legs */}
      <group ref={legsRef} position={[0, 0.4, 0]}>
        <mesh position={[-0.18, 0, 0]} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 0.8, 8]} />
          <meshStandardMaterial color="#222" />
        </mesh>
        <mesh position={[0.18, 0, 0]} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 0.8, 8]} />
          <meshStandardMaterial color="#222" />
        </mesh>
      </group>

      {/* Torso */}
      <mesh ref={torsoRef} position={[0, 0.85, 0]} castShadow>
        <cylinderGeometry args={[0.32, 0.28, 0.7, 12]} />
        <meshStandardMaterial color={teamTint} map={jerseyTexture as THREE.Texture | null} />
      </mesh>

      {/* Head (billboarded face later; for now a coloured sphere). */}
      <mesh position={[0, 1.5, 0]} castShadow>
        <sphereGeometry args={[0.18, 16, 12]} />
        <meshStandardMaterial color="#f3c393" />
      </mesh>

      {/* Number on the back as floating label (cheap stand-in for UV-mapped art). */}
      <Billboard position={[0, 0.95, 0]}>
        <Text fontSize={0.22} color={kit.text ?? "#FFFFFF"} anchorX="center" anchorY="middle">
          {player.number}
        </Text>
      </Billboard>

      {/* Nameplate */}
      <Billboard position={[0, 2.0, 0]}>
        <Text fontSize={0.22} color="#ffffff" outlineWidth={0.02} outlineColor="#000000" anchorX="center" anchorY="middle">
          {player.name}
        </Text>
      </Billboard>
    </group>
  );
}
