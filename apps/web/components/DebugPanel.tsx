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
 * frame count, current camera mode.
 *
 * Hidden by default, too much noise for end users. Open it via the
 * small `i` pill in the bottom-right corner, the `~` (or `\``) key, or
 * the legacy `D` key. The pill is the only persistent affordance; the
 * panel itself disappears when closed.
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
  const [open, setOpen] = useState(false);
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
      // Toggle on `~`, backtick (which lives on the same physical key
      // without shift), or the legacy `D` shortcut.
      if (
        e.key === "~" ||
        e.key === "`" ||
        e.key === "d" ||
        e.key === "D"
      ) {
        // Skip if user is typing in an input, `D` overlaps with
        // ordinary text entry.
        const tag = (e.target as HTMLElement | null)?.tagName ?? "";
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        className="debug-pill"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Hide debug panel" : "Show debug panel"}
        aria-pressed={open}
        data-testid="debug-pill"
        data-open={open ? "1" : "0"}
        title="Diagnostics (press ~ to toggle)"
      >
        <span className="debug-pill-i" aria-hidden>i</span>
      </button>

      {open ? (
        <div className="debug-panel" data-testid="debug-panel" role="dialog" aria-label="Diagnostics">
          <div className="debug-panel-head">
            <span className="debug-panel-title">Diagnostics</span>
            <button
              type="button"
              className="debug-close"
              onClick={() => setOpen(false)}
              aria-label="Hide debug panel"
            >
              ×
            </button>
          </div>
          <div className="debug-row">
            <span>match</span>
            <span>{matchId ?? "-"}</span>
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
          <div className="debug-panel-hint">
            <span>press </span>
            <kbd>~</kbd>
            <span> to toggle</span>
          </div>
        </div>
      ) : null}
    </>
  );
}
