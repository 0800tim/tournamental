"use client";

/**
 * RoundBond — one edge connecting two team atoms.
 *
 * v2: bonds remain cylinders but:
 *   - base thickness across all rounds is bumped slightly for legibility,
 *     respecting the round hierarchy (group < r32 < r16 < qf < sf < f).
 *   - bonds that sit on the highlighted path render in gold (#fbbf24)
 *     with 2× thickness and an emissive glow.
 *   - a small pulse-sphere travels along path bonds from rim → centre,
 *     completing one trip every ~3s. Disabled when reduce-motion is on.
 *   - group bonds fade out when `groupBondsVisible` is false (driven by
 *     the parent: visible at rest, hidden during camera-rotation /
 *     prolonged idle).
 *
 * Performance: ~103 cylinders + up to 5 small pulse spheres on the
 * champion path. All low-poly. Well within the 2022 mid-range Android
 * budget.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { MoleculeBond, MoleculeNode } from "@/lib/molecule/layout";

export interface RoundBondProps {
  bond: MoleculeBond;
  from: MoleculeNode;
  to: MoleculeNode;
  /** Generic "this bond is in focus" — bumps opacity + glow. */
  highlighted?: boolean;
  /** True when this bond is on the currently-highlighted path (gold). */
  onPath?: boolean;
  /** Path-relative ordering (0 = first / rim, n-1 = last / centre). For pulse staggering. */
  pathIndex?: number;
  /** Total number of bonds in the path; needed to phase the pulse along the trail. */
  pathLength?: number;
  /** Caller's reduce-motion preference. False = no pulse. */
  motionEnabled?: boolean;
  /** Group bonds: opacity is tweened to 0 when this is false. */
  groupBondsVisible?: boolean;
}

const PATH_GOLD = "#fbbf24";

export function RoundBond({
  bond,
  from,
  to,
  highlighted,
  onPath,
  pathIndex,
  pathLength,
  motionEnabled = true,
  groupBondsVisible = true,
}: RoundBondProps) {
  const { position, quaternion, length } = useMemo(() => {
    const a = new THREE.Vector3(...from.position);
    const b = new THREE.Vector3(...to.position);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.clone().normalize(),
    );
    return { position: mid, quaternion: q, length: len };
  }, [from.position, to.position]);

  // Base thickness — bumped across the board, scaled by stage rank.
  const stageThicknessMult: Record<MoleculeBond["stage"], number> = {
    group: 0.055,
    r32: 0.08,
    r16: 0.1,
    qf: 0.13,
    sf: 0.16,
    tp: 0.13,
    f: 0.22,
  };
  const baseRadius = bond.thickness * stageThicknessMult[bond.stage];
  const radius = onPath ? baseRadius * 2.0 : baseRadius;

  // Colour + opacity.
  const colour = onPath ? PATH_GOLD : bond.color;
  const baseOpacity = (() => {
    if (onPath) return 0.95;
    if (highlighted) return 0.95;
    if (bond.stage === "group") return 0.22;
    if (bond.stage === "r32") return 0.45;
    return 0.65;
  })();

  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const pulseRef = useRef<THREE.Mesh>(null);
  const pulseMatRef = useRef<THREE.MeshBasicMaterial>(null);

  // Pre-compute pulse animation period (seconds) and phase offset per bond.
  const PULSE_PERIOD = 3.0;
  const pathLen = pathLength ?? 1;
  const stagger = pathIndex !== undefined ? pathIndex / Math.max(1, pathLen) : 0;

  // Tween group-bond opacity toward target each frame, animate pulse.
  useFrame((state, dt) => {
    if (matRef.current) {
      let target = baseOpacity;
      if (bond.stage === "group" && !groupBondsVisible) target = 0;
      const cur = matRef.current.opacity;
      matRef.current.opacity = cur + (target - cur) * Math.min(1, dt * 3);
    }

    if (onPath && motionEnabled && pulseRef.current && pulseMatRef.current) {
      const t = (state.clock.elapsedTime % PULSE_PERIOD) / PULSE_PERIOD;
      const sliceWidth = 1 / Math.max(1, pathLen);
      const localStart = stagger;
      const localEnd = stagger + sliceWidth;
      let localT = -1;
      if (t >= localStart && t <= localEnd) {
        localT = (t - localStart) / sliceWidth;
      }
      if (localT >= 0 && localT <= 1) {
        // Pulse travels from outer-ring atom toward centre.
        const fromR = Math.hypot(from.position[0], from.position[2]);
        const toR = Math.hypot(to.position[0], to.position[2]);
        const startsAt = fromR > toR ? from.position : to.position;
        const endsAt = fromR > toR ? to.position : from.position;
        const px = startsAt[0] + (endsAt[0] - startsAt[0]) * localT;
        const py = startsAt[1] + (endsAt[1] - startsAt[1]) * localT;
        const pz = startsAt[2] + (endsAt[2] - startsAt[2]) * localT;
        pulseRef.current.position.set(px, py, pz);
        pulseMatRef.current.opacity = 0.95 * (1 - Math.abs(localT - 0.5) * 1.4);
        pulseRef.current.visible = true;
      } else {
        pulseRef.current.visible = false;
      }
    } else if (pulseRef.current) {
      pulseRef.current.visible = false;
    }
  });

  return (
    <>
      <mesh ref={meshRef} position={position} quaternion={quaternion}>
        <cylinderGeometry args={[radius, radius, length, 12, 1]} />
        <meshStandardMaterial
          ref={matRef}
          color={colour}
          emissive={colour}
          emissiveIntensity={
            onPath
              ? 0.9
              : highlighted
                ? 0.6
                : bond.stage === "f" || bond.stage === "sf" || bond.stage === "qf"
                  ? 0.35
                  : 0.1
          }
          roughness={0.45}
          metalness={0.25}
          transparent
          opacity={baseOpacity}
          depthWrite={!onPath && !highlighted}
        />
      </mesh>

      {/* Travelling pulse sphere — only on path bonds, only when motion is on. */}
      {onPath ? (
        <mesh ref={pulseRef} visible={false}>
          <sphereGeometry args={[radius * 2.4, 14, 12]} />
          <meshBasicMaterial
            ref={pulseMatRef}
            color={PATH_GOLD}
            transparent
            opacity={0}
            depthWrite={false}
          />
        </mesh>
      ) : null}
    </>
  );
}
