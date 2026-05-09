"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { getPerfMonitor } from "@/lib/perf-monitor";

/**
 * Mount once inside the `<Canvas/>`. Pumps `window.__vtornFps` etc.
 * for the Playwright phase-1 acceptance suite. No DOM, no React
 * state — pure useFrame side-effect.
 */
export function PerfMonitor() {
  const { gl } = useThree();
  useFrame(() => {
    const info = gl.info.render;
    getPerfMonitor().tick(undefined, { calls: info.calls, triangles: info.triangles });
  });
  return null;
}
