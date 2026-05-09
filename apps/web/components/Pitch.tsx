"use client";

import * as THREE from "three";
import { useMemo } from "react";

const FIELD_LENGTH = 100;
const FIELD_WIDTH = 64;

/**
 * Procedural pitch: one large green plane plus simple white line geometry
 * for boundary, halfway line, centre circle, and penalty boxes. The pitch
 * is centred at the origin and lies in the X/Z plane with +y up. Spec
 * coords are mapped to this convention by `lib/coords.ts` at the boundary.
 */
export function Pitch() {
  const lineMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ color: "#ffffff", linewidth: 2 }),
    [],
  );

  const lines = useMemo(() => buildPitchLines(), []);

  return (
    <group>
      <mesh receiveShadow rotation-x={-Math.PI / 2} position={[0, 0, 0]}>
        <planeGeometry args={[FIELD_LENGTH + 8, FIELD_WIDTH + 8]} />
        <meshStandardMaterial color="#1f6f3b" roughness={0.85} metalness={0} />
      </mesh>

      {/* Stripe overlay (subtle bands of darker green). */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.001, 0]}>
        <planeGeometry args={[FIELD_LENGTH, FIELD_WIDTH, 16, 1]} />
        <shaderMaterial
          transparent
          uniforms={useMemo(() => ({ uTime: { value: 0 } }), [])}
          vertexShader={`
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            varying vec2 vUv;
            void main() {
              float band = step(0.5, fract(vUv.x * 8.0));
              gl_FragColor = vec4(0.0, 0.0, 0.0, band * 0.07);
            }
          `}
        />
      </mesh>

      <lineSegments geometry={lines} material={lineMaterial} position={[0, 0.01, 0]} />
    </group>
  );
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
