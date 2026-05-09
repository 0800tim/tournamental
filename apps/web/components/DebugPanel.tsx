"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { MatchStore } from "@vtorn/spec-client";
import type { CameraMode } from "./CameraRig";

interface DebugPanelProps {
  store: StoreApi<MatchStore>;
  matchId?: string;
  mode: CameraMode;
}

/**
 * On-screen diagnostics: connection status, lag, fps, last state `t`,
 * frame count, and current camera mode. Toggle with `D` or click the
 * collapse handle.
 *
 * fps is a rolling estimate from requestAnimationFrame deltas, kept here
 * so we don't pull r3f-perf into the production bundle.
 */
export function DebugPanel({ store, matchId, mode }: DebugPanelProps) {
  const status = useStore(store, (s) => s.status);
  const lag = useStore(store, (s) => s.lagMs);
  const frameCount = useStore(store, (s) => s.frameCount);
  const lastT = useStore(store, (s) => s.curr?.t ?? 0);
  const eventCount = useStore(store, (s) => s.events.length);

  const [fps, setFps] = useState(0);
  const [open, setOpen] = useState(true);
  const samples = useRef<number[]>([]);

  useEffect(() => {
    let rafId = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      samples.current.push(dt);
      if (samples.current.length > 60) samples.current.shift();
      const avg = samples.current.reduce((s, n) => s + n, 0) / samples.current.length;
      setFps(avg > 0 ? Math.round(1000 / avg) : 0);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "d" || e.key === "D") setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) {
    return (
      <button type="button" className="debug-toggle" onClick={() => setOpen(true)} aria-label="Show debug panel">
        debug
      </button>
    );
  }

  return (
    <div className="debug-panel" data-testid="debug-panel">
      <div className="debug-row">
        <span>match</span>
        <span>{matchId ?? "—"}</span>
      </div>
      <div className="debug-row">
        <span>status</span>
        <span data-testid="debug-status">{status}</span>
      </div>
      <div className="debug-row">
        <span>fps</span>
        <span data-testid="debug-fps">{fps}</span>
      </div>
      <div className="debug-row">
        <span>lag</span>
        <span data-testid="debug-lag">{lag} ms</span>
      </div>
      <div className="debug-row">
        <span>last t</span>
        <span data-testid="debug-last-t">{lastT} ms</span>
      </div>
      <div className="debug-row">
        <span>frames</span>
        <span>{frameCount}</span>
      </div>
      <div className="debug-row">
        <span>events</span>
        <span>{eventCount}</span>
      </div>
      <div className="debug-row">
        <span>camera</span>
        <span>{mode}</span>
      </div>
      <button type="button" className="debug-close" onClick={() => setOpen(false)} aria-label="Hide debug panel">
        ×
      </button>
    </div>
  );
}
