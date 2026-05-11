"use client";

/**
 * TeamAtom — one team-sphere in the molecule.
 *
 * Renders a sphere coloured by the team's kit primary (falling back to the
 * stage palette colour), wrapped in a "rim glow" backside sphere that picks
 * up the gold/silver/bronze/etc palette indicating which round the team
 * went out at. A small HTML label floats over the sphere with the flag
 * emoji + 3-letter team code so the viewer can identify atoms without
 * having to remember team-code-to-flag.
 *
 * Performance: one Mesh + one Mesh + one drei <Html /> per atom. 48 atoms
 * total = 96 meshes + 48 DOM nodes. Well under the mid-range 2022 Android
 * budget when the scene's only doing orbit-cam transforms.
 */

import { useRef, useState } from "react";
import { Billboard, Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { FinalStage, MoleculeNode } from "@/lib/molecule/layout";
import { PALETTE } from "@/lib/molecule/layout";

export interface TeamAtomProps {
  node: MoleculeNode;
  flagEmoji: string | null;
  selected: boolean;
  hovered: boolean;
  onClick: (code: string) => void;
  onPointerEnter: (code: string) => void;
  onPointerLeave: (code: string) => void;
}

// Hex string → THREE.Color cache so we don't re-parse every frame.
const colourCache = new Map<string, THREE.Color>();
function toColour(hex: string): THREE.Color {
  let c = colourCache.get(hex);
  if (!c) {
    c = new THREE.Color(hex);
    colourCache.set(hex, c);
  }
  return c;
}

function rimColourFor(stage: FinalStage): string {
  return PALETTE[stage];
}

export function TeamAtom(props: TeamAtomProps) {
  const { node, flagEmoji, selected, hovered, onClick, onPointerEnter, onPointerLeave } = props;
  const meshRef = useRef<THREE.Mesh>(null);
  const rimRef = useRef<THREE.Mesh>(null);
  const [pulse, setPulse] = useState(0);

  const base = toColour(node.accentColor);
  const rim = toColour(rimColourFor(node.finalStage));

  // Slow pulse for the champion atom + hover/selected scale-up.
  useFrame((_, dt) => {
    if (!meshRef.current) return;
    const isChamp = node.finalStage === "champion";
    const target = (selected ? 1.18 : hovered ? 1.08 : 1) * (isChamp ? 1 + 0.05 * Math.sin(pulse) : 1);
    setPulse((p) => p + dt * 2.2);
    const cur = meshRef.current.scale.x;
    const next = cur + (target - cur) * Math.min(1, dt * 8);
    meshRef.current.scale.setScalar(next);
    if (rimRef.current) rimRef.current.scale.setScalar(next * 1.18);
  });

  return (
    <group position={node.position as unknown as [number, number, number]}>
      {/* Rim halo — back-side sphere that picks up the stage palette colour. */}
      <mesh ref={rimRef} scale={1.18}>
        <sphereGeometry args={[node.radius, 24, 24]} />
        <meshBasicMaterial
          color={rim}
          transparent
          opacity={node.finalStage === "champion" ? 0.55 : 0.32}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>

      {/* Main sphere. Standard material so it picks up the scene lights. */}
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          onClick(node.teamCode);
        }}
        onPointerEnter={(e) => {
          e.stopPropagation();
          onPointerEnter(node.teamCode);
          if (typeof document !== "undefined") document.body.style.cursor = "pointer";
        }}
        onPointerLeave={(e) => {
          e.stopPropagation();
          onPointerLeave(node.teamCode);
          if (typeof document !== "undefined") document.body.style.cursor = "auto";
        }}
      >
        <sphereGeometry args={[node.radius, 32, 32]} />
        <meshStandardMaterial
          color={base}
          roughness={0.45}
          metalness={0.25}
          emissive={rim}
          emissiveIntensity={selected ? 0.45 : node.finalStage === "champion" ? 0.32 : 0.16}
        />
      </mesh>

      {/* Flag emoji + team-code label, billboarded so it always faces the camera. */}
      <Billboard follow lockX={false} lockY={false} lockZ={false}>
        <Html
          center
          position={[0, node.radius * 1.55, 0]}
          distanceFactor={18}
          zIndexRange={[10, 0]}
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          <div
            className="molecule-label"
            data-stage={node.finalStage}
            data-selected={selected ? "true" : undefined}
          >
            {flagEmoji ? <span className="molecule-label-flag" aria-hidden>{flagEmoji}</span> : null}
            <span className="molecule-label-code">{node.teamCode}</span>
          </div>
        </Html>
      </Billboard>
    </group>
  );
}
