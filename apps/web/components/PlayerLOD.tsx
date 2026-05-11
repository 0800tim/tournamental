"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Phase-1 LOD strategy (docs/27a § "LOD strategy"):
 *
 * | Bucket | Distance       | Used for                     |
 * | ------ | -------------- | ---------------------------- |
 * | HIGH   | < 15 m         | 3-4 cam-focused players      |
 * | MED    | 15 m – 35 m    | nearby players               |
 * | LOW    | > 35 m         | far players                  |
 *
 * In v0.1 the MED bucket re-uses the HIGH mesh (same RPM body), the
 * docs note this is acceptable while we don't have a low-poly stand-in.
 * The LOW bucket renders a billboard fallback (the existing procedural
 * capsule body) so the per-frame mixer cost is skipped.
 *
 * The selector publishes the current bucket through a callback every
 * frame, with hysteresis to prevent thrash at the boundary. Components
 * upstream choose what to render based on the bucket.
 */

export type PlayerLODBucket = "high" | "med" | "low";

export const LOD_THRESHOLDS = {
  /** Below this distance → high. */
  highMax: 15,
  /** Below this distance → med. Above → low. */
  medMax: 35,
  /** Hysteresis: distance must move this much past a threshold to flip. */
  hysteresis: 1.5,
} as const;

/**
 * Pure helper: classify a distance into a LOD bucket given a previous
 * bucket (used for hysteresis). Exported for tests.
 */
export function classifyLODBucket(
  distance: number,
  previous: PlayerLODBucket = "high",
): PlayerLODBucket {
  const { highMax, medMax, hysteresis } = LOD_THRESHOLDS;

  if (previous === "high") {
    if (distance > highMax + hysteresis) {
      return distance > medMax + hysteresis ? "low" : "med";
    }
    return "high";
  }
  if (previous === "med") {
    if (distance < highMax - 0) return "high";
    if (distance > medMax + hysteresis) return "low";
    return "med";
  }
  // previous === "low"
  if (distance < medMax - hysteresis) {
    // Going low → med (further drop into HIGH happens next eval).
    return distance < highMax ? "med" : "med";
  }
  return "low";
}

export interface PlayerLODSelectorProps {
  /** World-space target point to measure distance from camera to. */
  target: React.RefObject<THREE.Object3D>;
  /** Called when the bucket changes. */
  onChange: (bucket: PlayerLODBucket) => void;
  /** How often to evaluate (ms). Default 200. */
  intervalMs?: number;
}

/**
 * Mount inside a player group. Watches camera distance every
 * `intervalMs` and calls `onChange` when the bucket flips. No re-renders
 *, purely a useFrame side-effect.
 */
export function PlayerLODSelector({ target, onChange, intervalMs = 200 }: PlayerLODSelectorProps) {
  const { camera } = useThree();
  const last = useRef<{ at: number; bucket: PlayerLODBucket }>({ at: 0, bucket: "high" });

  useFrame(() => {
    const now = performance.now();
    if (now - last.current.at < intervalMs) return;
    last.current.at = now;
    const obj = target.current;
    if (!obj) return;
    const d = camera.position.distanceTo(obj.getWorldPosition(_tmp));
    const next = classifyLODBucket(d, last.current.bucket);
    if (next !== last.current.bucket) {
      last.current.bucket = next;
      onChange(next);
    }
  });

  return null;
}

const _tmp = new THREE.Vector3();
