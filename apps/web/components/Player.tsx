"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { StoreApi } from "zustand/vanilla";
import type { EventMessage, Kit, Player as SpecPlayer } from "@vtorn/spec";
import type { MatchStore } from "@vtorn/spec-client";
import {
  applyJersey,
  applyKitColours,
  AvatarAnimationStateMachine,
  BillboardFace,
  deriveInitials,
  findCanonicalBone,
  makeJerseyTexture,
} from "@vtorn/avatar";
import {
  alphaForNow,
  estimateSpeed,
  interpolatePlayer,
} from "@/lib/interpolation";
import { toWorldInto, toWorldYaw } from "@/lib/coords";
import { useFaceLookup } from "@/lib/face-context";
import { useClonedBody } from "@/lib/body-cache";
import { useAnimationLibrary } from "@/lib/animation-library";
import { filterEventsForPlayer } from "@/lib/event-to-action";
import {
  classifyLODBucket,
  type PlayerLODBucket,
} from "./PlayerLOD";

interface PlayerProps {
  player: SpecPlayer;
  team: "home" | "away";
  kit: Kit;
  store: StoreApi<MatchStore>;
}

/**
 * Player avatar (Phase 1 — fidelity rig).
 *
 * Implements the Phase-1 spec from `docs/27a-fidelity-phase1-mocap-rig.md`:
 *
 *  - Loads a per-clone copy of the shared body GLB via `useClonedBody`
 *    (in v0.1 the body is the canonical Mixamo-named CC0 rig; the hook
 *    surface in `RpmAvatarProvider` is ready for a per-player swap).
 *  - Loads the shared animation library once at scene mount, retargeted
 *    to canonical bone names by `loadMixamoPack`.
 *  - Spins up an `AvatarAnimationStateMachine` per player. Speed and
 *    spec events feed the FSM; the FSM drives the AnimationMixer with
 *    crossfades + phase-locked playback rate (no foot sliding).
 *  - Selects a LOD bucket every ~200 ms. HIGH and MED render the rigged
 *    body + face billboard pinned to the head bone. LOW renders the
 *    cheaper procedural capsule body the codebase already had.
 *
 * Position / rotation is updated in `useFrame` via refs (no React
 * re-renders). The face billboard rides as a child of the
 * `mixamorigHead` bone so it tracks the rig's head pose; the LOD's
 * `<BillboardFace>` falls back to a kit-coloured initials disc when the
 * face image fails to load.
 */
export function Player({ player, team, kit, store }: PlayerProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const isGK = player.position === "GK";
  const initials = useMemo(() => deriveInitials(player.name), [player.name]);
  const faces = useFaceLookup();
  const faceUri = faces.resolve(player);
  const body = useClonedBody();
  const clipLibrary = useAnimationLibrary();

  const jerseyTexture = useMemo(
    () => makeJerseyTexture(kit, player.number, isGK),
    [kit, player.number, isGK]
  );

  const [lod, setLod] = useState<PlayerLODBucket>("high");
  const lastLodEvalRef = useRef({ at: 0, bucket: "high" as PlayerLODBucket });

  // Paint kit + jersey when the body clone is available.
  useEffect(() => {
    if (!body) return;
    applyJersey(body, jerseyTexture);
    applyKitColours(body, kit.primary, kit.secondary);
    body.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
  }, [body, jerseyTexture, kit.primary, kit.secondary]);

  // Build the FSM once the body + clip library are ready.
  const fsmRef = useRef<AvatarAnimationStateMachine | null>(null);
  useEffect(() => {
    if (!body || !clipLibrary) {
      fsmRef.current?.dispose();
      fsmRef.current = null;
      return;
    }
    const fsm = new AvatarAnimationStateMachine({
      root: body.scene,
      clips: clipLibrary,
      initialState: "idle",
    });
    fsmRef.current = fsm;
    return () => {
      fsm.dispose();
      fsmRef.current = null;
    };
  }, [body, clipLibrary]);

  // Find the head bone once the body arrives so the face billboard
  // rides the rig.
  const [headBone, setHeadBone] = useState<THREE.Object3D | null>(null);
  useEffect(() => {
    if (!body) {
      setHeadBone(null);
      return;
    }
    const bone = findCanonicalBone(body.scene, "mixamorigHead");
    setHeadBone(bone);
  }, [body]);

  const lastEventIdx = useRef(0);
  const tmpVec = useRef(new THREE.Vector3());

  useFrame((threeState, delta) => {
    const state = store.getState();
    if (!state.curr) return;

    const wallNow = Date.now();
    const alpha = alphaForNow(state.prevWallMs, state.currWallMs, wallNow);
    const interp = interpolatePlayer(state.prev, state.curr, player.id, alpha);
    if (!interp) return;

    toWorldInto(tmpVec.current, interp.pos);
    if (groupRef.current) {
      groupRef.current.position.copy(tmpVec.current);
      groupRef.current.rotation.y = toWorldYaw(interp.facing);
    }

    // LOD evaluation: cheap distance check, hysteresis-debounced.
    const now = performance.now();
    if (now - lastLodEvalRef.current.at >= 200 && groupRef.current) {
      lastLodEvalRef.current.at = now;
      const dist = threeState.camera.position.distanceTo(groupRef.current.position);
      const next = classifyLODBucket(dist, lastLodEvalRef.current.bucket);
      if (next !== lastLodEvalRef.current.bucket) {
        lastLodEvalRef.current.bucket = next;
        setLod(next);
      }
    }

    // Animation FSM step (only for HIGH/MED; LOW skips the mixer).
    const fsm = fsmRef.current;
    if (fsm && lod !== "low") {
      const speed = estimateSpeed(state.prev, state.curr, player.id);
      const events = state.events;
      const newEvents = events.slice(lastEventIdx.current) as EventMessage[];
      lastEventIdx.current = events.length;
      const filtered = filterEventsForPlayer(player.id, newEvents);
      for (const f of filtered) {
        fsm.consume(player.id, f.event);
      }
      fsm.tick(delta, speed);
    } else if (lod === "low") {
      // Keep the event index advanced so we don't replay them when we
      // come back into HIGH/MED.
      lastEventIdx.current = state.events.length;
    }
  });

  return (
    <group ref={groupRef}>
      {/* HIGH / MED: rigged body GLB. */}
      {body && lod !== "low" ? (
        <primitive object={body.scene} />
      ) : null}

      {/* LOW: cheap procedural capsule. */}
      {lod === "low" ? <ProceduralBodyLow kit={kit} jersey={jerseyTexture} /> : null}

      {/* Face billboard. Attaches to the head bone if available so it
          rides the rig. Falls back to an offset above the group origin
          for the LOW bucket. */}
      {headBone && lod !== "low" ? (
        <FaceOnBone bone={headBone} faceUri={faceUri} kit={kit} initials={initials} />
      ) : (
        <BillboardFace faceUri={faceUri} kit={kit} initials={initials} yOffset={1.85} size={0.42} />
      )}

      <NamePlate name={player.name} number={player.number} kit={kit} />
    </group>
  );
}

/**
 * Mount a `<BillboardFace/>` as a child of `bone` so it tracks the
 * rig's head pose without being a part of the skinned mesh.
 */
function FaceOnBone({
  bone,
  faceUri,
  kit,
  initials,
}: {
  bone: THREE.Object3D;
  faceUri: string | undefined;
  kit: Kit;
  initials: string;
}) {
  const groupRef = useRef<THREE.Group>(null!);
  useEffect(() => {
    const g = groupRef.current;
    if (!g || !bone) return;
    bone.add(g);
    return () => {
      bone.remove(g);
    };
  }, [bone]);
  return (
    <group ref={groupRef} position={[0, 0.18, 0]}>
      <BillboardFace faceUri={faceUri} kit={kit} initials={initials} yOffset={0} size={0.32} />
    </group>
  );
}

/**
 * Capsule fallback for the LOW bucket — same look the codebase shipped
 * before Phase 1, fast-path far-away players where rigged animation
 * isn't readable anyway.
 */
function ProceduralBodyLow({ kit, jersey }: { kit: Kit; jersey: THREE.Texture }) {
  return (
    <>
      <group position={[0, 0.4, 0]}>
        <mesh position={[-0.18, 0, 0]} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 0.8, 8]} />
          <meshStandardMaterial color="#222" />
        </mesh>
        <mesh position={[0.18, 0, 0]} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 0.8, 8]} />
          <meshStandardMaterial color="#222" />
        </mesh>
      </group>
      <mesh position={[0, 0.85, 0]} castShadow>
        <cylinderGeometry args={[0.32, 0.28, 0.7, 12]} />
        <meshStandardMaterial color={kit.primary} map={jersey} />
      </mesh>
    </>
  );
}

/** Floating name + number nameplate. */
function NamePlate({ name, number, kit }: { name: string; number: number; kit: Kit }) {
  const ref = useRef<THREE.Sprite>(null!);
  // Decompose Kit into its leaf colour fields so we don't recreate the
  // texture on identity changes that don't affect appearance.
  const texture = useMemo(
    () => makeNamePlateTexture(name, number, kit),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, number, kit.primary, kit.secondary, kit.text]
  );
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

  ctx.fillStyle = "rgba(8, 14, 22, 0.85)";
  roundRect(ctx, 0, 0, 512, 128, 36);
  ctx.fill();

  ctx.fillStyle = kit.primary;
  roundRect(ctx, 12, 16, 96, 96, 16);
  ctx.fill();

  ctx.fillStyle = kit.text ?? "#FFFFFF";
  ctx.font = "bold 64px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(number), 60, 64);

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
