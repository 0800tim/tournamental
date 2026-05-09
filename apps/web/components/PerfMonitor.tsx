"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { getPerfMonitor } from "@/lib/perf-monitor";

/**
 * Mount once inside the `<Canvas/>`. Pumps `window.__vtornFps` etc.
 * for the Playwright phase-1 acceptance suite. Phase-2 also exposes
 * the director's active camera + slow-mo rate via a sibling DOM
 * element (`.perf-monitor[data-cam][data-rate][data-fps]`) so the
 * Playwright director spec can sample without reaching into R3F
 * internals.
 */
export function PerfMonitor() {
  const { gl, camera } = useThree();
  const lastPublishRef = useRef(0);

  useEffect(() => {
    if (typeof document === "undefined") return;
    let el = document.querySelector(".perf-monitor");
    if (!el) {
      el = document.createElement("div");
      el.className = "perf-monitor";
      (el as HTMLElement).style.display = "none";
      document.body.appendChild(el);
    }
    return () => {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    };
  }, []);

  useFrame(() => {
    const info = gl.info.render;
    getPerfMonitor().tick(undefined, { calls: info.calls, triangles: info.triangles });

    // Publish director state every ~ 6 frames to keep cost negligible.
    const now = performance.now();
    if (now - lastPublishRef.current < 100) return;
    lastPublishRef.current = now;

    if (typeof document === "undefined") return;
    const el = document.querySelector(".perf-monitor") as HTMLElement | null;
    if (!el) return;
    const cam = (camera.userData?.directorCam as string | undefined) ?? "broadcast";
    const rate = (camera.userData?.slowMoRate as number | undefined) ?? 1;
    const fps =
      (typeof window !== "undefined" && window.__vtornFps) || 0;
    el.setAttribute("data-cam", cam);
    el.setAttribute("data-rate", String(rate));
    el.setAttribute("data-fps", String(fps));
  });
  return null;
}
