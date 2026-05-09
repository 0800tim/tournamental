"use client";

import { useEffect, useState } from "react";
import {
  replayBadgeVisible,
  replayHudBus,
  scorerOpacity,
  slowMoLabel,
  type ReplayHudState,
} from "@/lib/director/replay-hud-bus";

/**
 * Phase-4 broadcast-style replay HUD overlay.
 *
 * Per `docs/27d-fidelity-phase4-magnus-mobile.md`:
 *
 *   - Score widget top-left.
 *   - "REPLAY" badge top-right (only during goal-replay + celebration).
 *   - Scorer nameplate fades in 0.4 s after the cut.
 *
 * All HTML, no WebGL — costs nothing in render budget.
 * `pointer-events: none` so it never steals clicks.
 */
export function ReplayHUD() {
  const [state, setState] = useState<ReplayHudState>(() => replayHudBus.current());

  useEffect(() => {
    return replayHudBus.subscribe(setState);
  }, []);

  const visible = replayBadgeVisible(state);
  const fadeOpacity = scorerOpacity(state);
  const slowMo = slowMoLabel(state.slowMoRate);

  return (
    <div
      className="replay-hud"
      data-testid="replay-hud"
      data-visible={visible ? "1" : "0"}
      aria-live="polite"
    >
      <div className="replay-hud-score" data-testid="replay-hud-score">
        <span className="replay-hud-score-team">{state.scorerTeam ?? ""}</span>
        <span className="replay-hud-score-num">{state.scoreHome}</span>
        <span className="replay-hud-score-dash">-</span>
        <span className="replay-hud-score-num">{state.scoreAway}</span>
      </div>

      {visible ? (
        <div
          className="replay-hud-badge"
          data-testid="replay-hud-badge"
          data-cam={state.cam}
        >
          <span className="replay-hud-badge-dot" aria-hidden />
          <span className="replay-hud-badge-text">REPLAY</span>
          {slowMo ? (
            <span className="replay-hud-badge-rate" data-testid="replay-hud-rate">
              {slowMo}
            </span>
          ) : null}
        </div>
      ) : null}

      {state.scorerName ? (
        <div
          className="replay-hud-scorer"
          data-testid="replay-hud-scorer"
          style={{ opacity: fadeOpacity }}
        >
          <span className="replay-hud-scorer-clock">{formatMatchSec(state.goalAtMatchSec)}</span>
          <span className="replay-hud-scorer-name">{state.scorerName}</span>
        </div>
      ) : null}
    </div>
  );
}

function formatMatchSec(sec: number): string {
  const mins = Math.floor(sec / 60);
  return `${mins}'`;
}
