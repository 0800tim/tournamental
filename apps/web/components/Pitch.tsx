"use client";

import * as THREE from "three";
import { useMemo } from "react";

const FIELD_LENGTH = 100;
const FIELD_WIDTH = 64;

/**
 * Procedural pitch with PBR-tweaked striped grass.
 *
 * Doc 04 calls for "procedural striped grass texture as a baseline" — we
 * paint a 1024x512 canvas with ~10 alternating stripes plus subtle noise
 * dapple, drop it into a `MeshStandardMaterial` with high roughness, and
 * rely on the scene lighting rig to do the rest. The pitch always
 * receives shadows.
 */
export function Pitch() {
  const grassTexture = useMemo(() => makeGrassTexture(), []);

  const lineMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ color: "#ffffff", linewidth: 2 }),
    [],
  );

  const lines = useMemo(() => buildPitchLines(), []);

  return (
    <group>
      <mesh receiveShadow rotation-x={-Math.PI / 2} position={[0, 0, 0]}>
        <planeGeometry args={[FIELD_LENGTH + 8, FIELD_WIDTH + 8]} />
        <meshStandardMaterial
          map={grassTexture as THREE.Texture | null}
          color="#1f6f3b"
          roughness={0.92}
          metalness={0}
        />
      </mesh>

      <lineSegments geometry={lines} material={lineMaterial} position={[0, 0.01, 0]} />
    </group>
  );
}

/**
 * Build a tiling grass texture with ~10 stripes of alternating shades plus
 * a low-frequency dapple. Cached by useMemo at the call site.
 */
function makeGrassTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  // 2048×1024 keeps stripes crisp at glancing angles. Power-of-two
  // dimensions also guarantee mipmaps generate cleanly.
  c.width = 2048;
  c.height = 1024;
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  // Base.
  ctx.fillStyle = "#1f6f3b";
  ctx.fillRect(0, 0, c.width, c.height);

  // Stripes along the length axis. 10 stripes total → bright/dim alternating.
  // We draw a soft gradient on each stripe edge to avoid step-aliasing
  // shimmer when the camera looks down the pitch at a low angle.
  const stripeCount = 10;
  const stripeW = c.width / stripeCount;
  for (let i = 0; i < stripeCount; i += 1) {
    if (i % 2 === 0) continue;
    const x = i * stripeW;
    const grad = ctx.createLinearGradient(x, 0, x + stripeW, 0);
    grad.addColorStop(0, "#1a5d33");
    grad.addColorStop(0.04, "#1c6336");
    grad.addColorStop(0.5, "#1a5d33");
    grad.addColorStop(0.96, "#1c6336");
    grad.addColorStop(1, "#1a5d33");
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, stripeW, c.height);
  }

  // Subtle dapple via sparse low-alpha squares — cheap noise approximation.
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 3000; i += 1) {
    ctx.fillStyle = Math.random() > 0.5 ? "#0f3a1f" : "#2c8c4b";
    const x = Math.random() * c.width;
    const y = Math.random() * c.height;
    const s = 1 + Math.random() * 3;
    ctx.fillRect(x, y, s, s);
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  // Clamp wrapping (the plane is sized to the pitch) but let mipmaps
  // generate so distant areas of the field don't shimmer.
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  // Anisotropy capped to a sane mid-range value; the WebGL renderer
  // clamps to its hardware max regardless.
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function buildPitchLines(): THREE.BufferGeometry {
  const segments: number[] = [];

  const halfL = FIELD_LENGTH / 2;
  const halfW = FIELD_WIDTH / 2;

  // Helper: spec (x, y) → world (x, 0, -y).
  const push = (x1: number, y1: number, x2: number, y2: number) => {
    segments.push(x1, 0, -y1, x2, 0, -y2);
  };

  // Boundary.
  push(-halfL, -halfW, halfL, -halfW);
  push(halfL, -halfW, halfL, halfW);
  push(halfL, halfW, -halfL, halfW);
  push(-halfL, halfW, -halfL, -halfW);

  // Halfway line.
  push(0, -halfW, 0, halfW);

  // Centre circle.
  const segs = 48;
  const r = 9.15;
  for (let i = 0; i < segs; i += 1) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    push(Math.cos(a0) * r, Math.sin(a0) * r, Math.cos(a1) * r, Math.sin(a1) * r);
  }

  // Penalty boxes (16.5 m × 40.32 m).
  const pbL = 16.5;
  const pbHalfW = 40.32 / 2;
  // Left box.
  push(-halfL, -pbHalfW, -halfL + pbL, -pbHalfW);
  push(-halfL + pbL, -pbHalfW, -halfL + pbL, pbHalfW);
  push(-halfL + pbL, pbHalfW, -halfL, pbHalfW);
  // Right box.
  push(halfL, -pbHalfW, halfL - pbL, -pbHalfW);
  push(halfL - pbL, -pbHalfW, halfL - pbL, pbHalfW);
  push(halfL - pbL, pbHalfW, halfL, pbHalfW);

  // Six-yard boxes (5.5 m × 18.32 m).
  const sbL = 5.5;
  const sbHalfW = 18.32 / 2;
  push(-halfL, -sbHalfW, -halfL + sbL, -sbHalfW);
  push(-halfL + sbL, -sbHalfW, -halfL + sbL, sbHalfW);
  push(-halfL + sbL, sbHalfW, -halfL, sbHalfW);
  push(halfL, -sbHalfW, halfL - sbL, -sbHalfW);
  push(halfL - sbL, -sbHalfW, halfL - sbL, sbHalfW);
  push(halfL - sbL, sbHalfW, halfL, sbHalfW);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(segments, 3));
  return geom;
}
