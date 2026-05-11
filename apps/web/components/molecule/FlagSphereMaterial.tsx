"use client";

/**
 * FlagSphereMaterial, a `MeshStandardMaterial` augmented with a tiny
 * GLSL vertex displacement so each flag-textured sphere reads as a
 * "country football rippling in the wind" instead of a flat decal.
 *
 * We extend MeshStandardMaterial via `onBeforeCompile` rather than
 * writing a full custom ShaderMaterial. This way the sphere still picks
 * up the scene's directional + ambient lights with PBR shading (the
 * standard chunk does all the heavy lifting), and we only need to inject
 * ~20 lines of GLSL to add the wave.
 *
 * Why not three-stdlib's `Sky` / `Water` shaders or a community
 * displacement-material? Bundle budget. Our wave is ~1KB of GLSL.
 *
 * Reduce-motion: caller passes `motionEnabled`, false means the
 * vertex shader is still installed but `uWaveAmp` clamps to 0, leaving
 * a static-but-correct sphere.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { getFlagTexture } from "@/lib/molecule/flag-texture";
import { stableHash01 } from "@/lib/molecule/layout";

export interface FlagSphereMaterialProps {
  teamCode: string;
  accent: string;
  motionEnabled: boolean;
  /** Multiplier on wave amplitude (1.0 = base; 1.5 when hovered, etc.) */
  waveBoost?: number;
  /** Rim glow tint and intensity. */
  emissive: THREE.Color | string;
  emissiveIntensity?: number;
  /** Pass to give the predicted champion a permanently stronger wave. */
  isChampion?: boolean;
  /** When true, the path-highlight gold rim is layered into the emissive. */
  onPath?: boolean;
}

const VERT_HEAD = /* glsl */ `
uniform float uTime;
uniform float uWaveAmp;
uniform float uWaveSpeed;
uniform float uPhaseOffset;
`;

const VERT_DISPLACE = /* glsl */ `
  // Subtle "wind ripple" along the sphere surface. We displace along
  // the vertex normal so the bumps stay perpendicular to the surface.
  // The displacement amount oscillates with two superimposed sines so
  // adjacent spheres don't read as identical even with the same time.
  float phase = uPhaseOffset;
  float w1 = sin(uv.x * 9.4 + uTime * uWaveSpeed * 0.95 + phase);
  float w2 = sin(uv.y * 7.0 + uTime * uWaveSpeed * 0.71 + phase * 1.7);
  float wave = (w1 * 0.55 + w2 * 0.45) * uWaveAmp;
  transformed += normal * wave;
`;

export function FlagSphereMaterial(props: FlagSphereMaterialProps) {
  const {
    teamCode,
    accent,
    motionEnabled,
    waveBoost = 1,
    emissive,
    emissiveIntensity = 0.16,
    isChampion = false,
    onPath = false,
  } = props;

  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const uniformsRef = useRef<{
    uTime: { value: number };
    uWaveAmp: { value: number };
    uWaveSpeed: { value: number };
    uPhaseOffset: { value: number };
  } | null>(null);

  // Stable per-atom phase offset so spheres don't ripple in sync.
  const phase = useMemo(
    () => stableHash01(teamCode + ":phase") * Math.PI * 2,
    [teamCode],
  );

  // Get-or-load the flag texture. Returns a CanvasTexture that updates
  // itself in-place once the SVG fetch resolves.
  const flagTexture = useMemo(
    () => getFlagTexture(teamCode, accent),
    [teamCode, accent],
  );

  // Set up shader injection on the underlying MeshStandardMaterial.
  useEffect(() => {
    const mat = matRef.current;
    if (!mat) return;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uWaveAmp = { value: 0 };
      shader.uniforms.uWaveSpeed = { value: 1.8 };
      shader.uniforms.uPhaseOffset = { value: phase };
      uniformsRef.current = shader.uniforms as typeof uniformsRef.current;

      shader.vertexShader = shader.vertexShader.replace(
        "void main() {",
        `${VERT_HEAD}\nvoid main() {`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\n${VERT_DISPLACE}`,
      );
    };

    // Force re-compile when the closure-captured phase changes.
    mat.needsUpdate = true;
  }, [phase]);

  // Drive uniforms every frame.
  useFrame((_, dt) => {
    const u = uniformsRef.current;
    if (!u) return;
    u.uTime.value += dt;
    // Base wave amp = 3% of sphere radius (the sphere itself is unit-
    // scaled at the geometry level; the parent group sets the actual
    // radius via scale). 3% of radius is 0.03 in unit-sphere space, but
    // we pre-multiply by the parent's local scale via uniform-only
    // mode and let visual feedback inform the dial.
    const base = motionEnabled ? 0.03 : 0;
    const champBoost = isChampion ? 1.35 : 1;
    const target = base * waveBoost * champBoost;
    // Smooth approach so a sudden hover bump doesn't snap.
    const cur = u.uWaveAmp.value;
    u.uWaveAmp.value = cur + (target - cur) * Math.min(1, dt * 6);
  });

  return (
    <meshStandardMaterial
      ref={matRef}
      map={flagTexture ?? undefined}
      color={flagTexture ? "#ffffff" : accent}
      roughness={0.45}
      metalness={0.18}
      emissive={emissive as THREE.Color}
      emissiveIntensity={onPath ? Math.max(emissiveIntensity, 0.08) : emissiveIntensity}
    />
  );
}
