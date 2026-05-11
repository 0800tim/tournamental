"use client";

/**
 * RoundBond — one edge connecting two team atoms.
 *
 * We render as a simple cylinder oriented between the two atom centres.
 * Cylinders look better than `<Line />` in 3D because they have volume
 * (don't get hairline-thin from distance) and respond to the scene lights
 * (the stage palette colour reads as warmer in shaded faces).
 *
 * Performance: 72 group bonds + 31 knockout bonds = 103 cylinders. Each
 * cylinder is a tiny mesh (8-segment tube). Well within the budget.
 */

import { useMemo } from "react";
import * as THREE from "three";

import type { MoleculeBond, MoleculeNode } from "@/lib/molecule/layout";

export interface RoundBondProps {
  bond: MoleculeBond;
  from: MoleculeNode;
  to: MoleculeNode;
  /** When set, this bond is "in focus" (e.g. selected team's match) — bumped opacity + glow. */
  highlighted?: boolean;
}

export function RoundBond({ bond, from, to, highlighted }: RoundBondProps) {
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

  const opacity = highlighted ? 0.95 : bond.stage === "group" ? 0.18 : bond.stage === "r32" ? 0.35 : 0.55;

  return (
    <mesh position={position} quaternion={quaternion}>
      <cylinderGeometry args={[bond.thickness * 0.04, bond.thickness * 0.04, length, 8, 1]} />
      <meshStandardMaterial
        color={bond.color}
        emissive={bond.color}
        emissiveIntensity={highlighted ? 0.6 : bond.stage === "f" || bond.stage === "sf" || bond.stage === "qf" ? 0.35 : 0.1}
        roughness={0.5}
        metalness={0.2}
        transparent
        opacity={opacity}
        depthWrite={!highlighted}
      />
    </mesh>
  );
}
