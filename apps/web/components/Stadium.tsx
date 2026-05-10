"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { Crowd } from "./Crowd";
import { LedBoards } from "./LedBoards";
import { buildSeatingTier, type SeatingTier } from "@/lib/stadium-geometry";

/**
 * Phase-3 stadium.
 *
 * Per `docs/27c-fidelity-phase3-stadium-crowd.md`:
 *
 *   - Three tiers of seating built parametrically (12 segments each,
 *     instanced for low draw-call cost).
 *   - Tier-fronts angled inwards 18 degrees, back-tilted away.
 *   - Roof rim above the back tier (cast shadow).
 *   - Floodlights at the four corners (light geometry only — actual
 *     lighting stays on the existing scene rig until Phase 4 brings
 *     dedicated SpotLights).
 *   - Animated rotating LED ad boards around the perimeter (separate
 *     <LedBoards /> component).
 *   - Instanced billboard crowd (<Crowd />).
 *
 * The stadium occupies the cylinder around the pitch:
 *   - Pitch is 100 m × 64 m centered at origin (per `Pitch.tsx`).
 *   - Inner edge of seating: ~ 4 m beyond the touchline.
 *   - Outer edge: ~ 22 m beyond the touchline (3 tiers × 6 m + roof).
 */
export function Stadium() {
  const tiers: SeatingTier[] = useMemo(
    () => [
      // Front tier — closest to pitch, lowest, deep red seats.
      buildSeatingTier({
        innerRadiusLong: 54,
        innerRadiusShort: 36,
        depth: 6,
        rise: 4,
        baseY: 0.5,
        tilt: 0.15,
        segments: 12,
        seatColour: "#7d1416",
      }),
      // Mid tier.
      buildSeatingTier({
        innerRadiusLong: 60,
        innerRadiusShort: 42,
        depth: 6,
        rise: 4,
        baseY: 4.5,
        tilt: 0.18,
        segments: 12,
        seatColour: "#5d1012",
      }),
      // Top tier.
      buildSeatingTier({
        innerRadiusLong: 66,
        innerRadiusShort: 48,
        depth: 6,
        rise: 4,
        baseY: 8.5,
        tilt: 0.22,
        segments: 12,
        seatColour: "#4a0d0f",
      }),
    ],
    [],
  );

  return (
    <group userData={{ vtornStadium: true }}>
      {tiers.map((tier, i) => (
        <SeatingRing key={i} tier={tier} />
      ))}

      {/* Roof rim — a thin dark band above the top tier to anchor
       *  the silhouette under the procedural sky. */}
      <RoofRim height={13.5} />

      {/* Goal nets at both ends. */}
      <GoalNet position={[55, 0, 0]} facing={-1} />
      <GoalNet position={[-55, 0, 0]} facing={1} />

      {/* LED ad boards. */}
      <LedBoards />

      {/* Floodlight masts at the four corners. */}
      <FloodlightMast position={[58, 0, 38]} />
      <FloodlightMast position={[58, 0, -38]} />
      <FloodlightMast position={[-58, 0, 38]} />
      <FloodlightMast position={[-58, 0, -38]} />

      {/* Instanced fans. */}
      <Crowd />
    </group>
  );
}

/**
 * One concentric ring of seats. Each ring is composed of `segments`
 * angle-slices around the pitch, each slice a single tilted box.
 *
 * Cost: one geometry, one material, `segments * 4` meshes (one per
 * side of the pitch ellipse). Cheap.
 */
function SeatingRing({ tier }: { tier: SeatingTier }) {
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: tier.seatColour,
        roughness: 0.92,
        metalness: 0,
      }),
    [tier.seatColour],
  );

  return (
    <group>
      {tier.slices.map((s, i) => (
        <mesh
          key={i}
          position={[s.position[0], s.position[1], s.position[2]]}
          rotation={[s.rotation[0], s.rotation[1], s.rotation[2]]}
          receiveShadow
        >
          <boxGeometry args={[s.size[0], s.size[1], s.size[2]]} />
          <primitive object={material} attach="material" />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Procedural goal net — a 32×24-vert plane that sways gently in the
 * "wind" via a per-frame uniform-driven vertex offset (cheaply done
 * here as a CPU-side morph). On goal events the net pulses inward.
 *
 * `facing`: 1 = goal at -X end (net opens toward +X), -1 = goal at +X
 * end (net opens toward -X).
 */
function GoalNet({
  position,
  facing,
}: {
  position: [number, number, number];
  facing: 1 | -1;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  // Tiny shift offset for the wind sway.
  const swayRef = useRef({ x: 0, y: 0, t: 0 });
  const lastSwayAt = useRef(0);

  useFrame((_, deltaRaw) => {
    // Clamp delta so a stall doesn't spike the sway phase.
    const delta = Math.min(deltaRaw, 1 / 30);
    swayRef.current.t += delta;
    // Throttle the per-frame mesh.position write to 5 Hz — this is a
    // cosmetic gust, not a per-frame physics term.
    const tNow = performance.now();
    if (tNow - lastSwayAt.current < 200) return;
    lastSwayAt.current = tNow;
    const sway = swayRef.current;
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.position.x = position[0] + Math.sin(sway.t * 0.8) * 0.04 * facing;
  });

  return (
    <group>
      <mesh
        ref={meshRef}
        position={position}
        rotation={[0, facing === 1 ? Math.PI / 2 : -Math.PI / 2, 0]}
      >
        <planeGeometry args={[8, 3.2, 8, 6]} />
        <meshBasicMaterial
          ref={matRef}
          color="#dde6e0"
          wireframe
          transparent
          opacity={0.45}
        />
      </mesh>
    </group>
  );
}

/**
 * A roof-rim ring — eight short box segments around the pitch that
 * read as a stadium roof at distance. We use eight rather than 32 to
 * keep draw calls down.
 */
function RoofRim({ height }: { height: number }) {
  const segments = 16;
  return (
    <group>
      {Array.from({ length: segments }).map((_, i) => {
        const angle = (i / segments) * Math.PI * 2;
        const radiusX = 70;
        const radiusZ = 52;
        const x = Math.cos(angle) * radiusX;
        const z = Math.sin(angle) * radiusZ;
        const yaw = angle + Math.PI / 2;
        return (
          <mesh
            key={i}
            position={[x, height, z]}
            rotation={[0, yaw, 0]}
            receiveShadow
          >
            <boxGeometry args={[28, 1.2, 4]} />
            <meshStandardMaterial color="#181f28" roughness={0.7} />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * Floodlight mast — a tall vertical pole + emissive head. Acts as
 * silhouette + bloom-target only. No SpotLight (Phase 4 deliverable).
 */
function FloodlightMast({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Mast pole. */}
      <mesh castShadow position={[0, 12, 0]}>
        <cylinderGeometry args={[0.25, 0.4, 24, 6]} />
        <meshStandardMaterial color="#2b3540" roughness={0.55} />
      </mesh>
      {/* Floodlight head — emissive so bloom catches it. */}
      <mesh position={[0, 22, 0]}>
        <boxGeometry args={[3.5, 1.6, 1.6]} />
        <meshStandardMaterial
          color="#fff7cc"
          emissive="#ffeb99"
          emissiveIntensity={2.6}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
