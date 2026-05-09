"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { StoreApi } from "zustand/vanilla";
import type { Kit, Player as SpecPlayer } from "@vtorn/spec";
import type { MatchStore } from "@vtorn/spec-client";
import {
  applyJersey,
  applyKitColours,
  BillboardFace,
  deriveInitials,
  makeJerseyTexture,
} from "@vtorn/avatar";
import {
  alphaForNow,
  estimateSpeed,
  interpolatePlayer,
} from "@/lib/interpolation";
import { stepFsm, INITIAL_FSM_STATE, activeTag, type FsmState } from "@/lib/animation-fsm";
import { toWorldInto, toWorldYaw } from "@/lib/coords";
import { useFaceLookup } from "@/lib/face-context";
import { useClonedBody } from "@/lib/body-cache";

interface PlayerProps {
  player: SpecPlayer;
  team: "home" | "away";
  kit: Kit;
  store: StoreApi<MatchStore>;
}

/**
 * Player avatar (doc 07 tier 3 — shared body GLB + billboard face).
 *
 * The shared body GLB is loaded once at the scene level (see
 * `useClonedBody()` which delegates to `@vtorn/avatar`'s module-cached
 * loader). Each player gets an independent skeleton clone so per-player
 * jersey textures don't collide.
 *
 * If the GLB hasn't loaded yet (or fails), we fall back to a minimal
 * capsule body so the renderer still has something on screen — matches
 * the failure mode in docs/07.
 *
 * Position/rotation/animation state is updated every frame via refs (no
 * React re-renders).
 */
export function Player({ player, team, kit, store }: PlayerProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const torsoRef = useRef<THREE.Mesh>(null!);
  const legsRef = useRef<THREE.Group>(null!);
  const isGK = player.position === "GK";
  const initials = useMemo(() => deriveInitials(player.name), [player.name]);
  const faces = useFaceLookup();
  const faceUri = faces.resolve(player);
  const body = useClonedBody();

  const jerseyTexture = useMemo(
    () => makeJerseyTexture(kit, player.number, isGK),
    [kit, player.number, isGK]
  );

  // When the body clone arrives, paint the kit + jersey texture in place.
  useEffect(() => {
    if (!body) return;
    applyJersey(body, jerseyTexture);
    applyKitColours(body, kit.primary, kit.secondary);
    // Make sure every mesh in the cloned body casts/receives shadows.
    body.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
  }, [body, jerseyTexture, kit.primary, kit.secondary]);

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

    // Cheap procedural motion for the fallback capsule. When the rigged
    // body GLB exposes named animation clips we'll swap this for a real
    // mixer (see docs/07 followups).
    if (torsoRef.current && legsRef.current) {
      let lean = 0;
      let bob = 0;
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
          break;
        default:
          break;
      }
      torsoRef.current.rotation.x = lean;
      torsoRef.current.position.y = 0.85 + bob;
      legsRef.current.rotation.x = -lean * 0.6;
      const stride =
        tag === "sprint"
          ? 1.0 + Math.sin(now * 0.03) * 0.25
          : tag === "run"
            ? 1.0 + Math.sin(now * 0.022) * 0.15
            : 1.0;
      legsRef.current.scale.y = stride;
    }
  });

  const teamTint = team === "home" ? kit.primary : kit.primary;

  return (
    <group ref={groupRef}>
      {/* Real body GLB clone. Falls back to capsule if the load is in flight. */}
      {body ? (
        <primitive object={body.scene} />
      ) : (
        <>
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
        </>
      )}

      {/* Real face billboard from Wikidata; falls back to initials disc. */}
      <BillboardFace faceUri={faceUri} kit={kit} initials={initials} yOffset={1.85} size={0.42} />

      {/* Nameplate (tiny label below the face). */}
      <NamePlate name={player.name} number={player.number} kit={kit} />
    </group>
  );
}

/** Floating name + number nameplate, separated for readability. */
function NamePlate({
  name,
  number,
  kit,
}: {
  name: string;
  number: number;
  kit: Kit;
}) {
  const ref = useRef<THREE.Sprite>(null!);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const texture = useMemo(() => makeNamePlateTexture(name, number, kit), [name, number, kit.primary, kit.secondary, kit.text]);
  useEffect(() => () => texture?.dispose(), [texture]);
  if (!texture) return null;
  return (
    <sprite ref={ref} position={[0, 2.4, 0]} scale={[1.2, 0.32, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  );
}

function makeNamePlateTexture(name: string, number: number, kit: Kit): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  // Pill background.
  ctx.fillStyle = "rgba(8, 14, 22, 0.85)";
  roundRect(ctx, 0, 0, 512, 128, 36);
  ctx.fill();

  // Number swatch.
  ctx.fillStyle = kit.primary;
  roundRect(ctx, 12, 16, 96, 96, 16);
  ctx.fill();

  ctx.fillStyle = kit.text ?? "#FFFFFF";
  ctx.font = "bold 64px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(number), 60, 64);

  // Name.
  ctx.fillStyle = "#e6edf3";
  ctx.font = "600 56px Inter, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(name, 132, 66);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
