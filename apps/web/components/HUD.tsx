"use client";

import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { MatchStore } from "@tournamental/spec-client";

interface HUDProps {
  store: StoreApi<MatchStore>;
}

/**
 * Auxiliary 2D overlay, owns the shootout panel + commentary ticker +
 * event banner. The primary scoreboard (team flags, score, minute) and
 * the broadcast stats panels live in `MatchStatsHUD` so this component
 * is intentionally narrow.
 *
 * `pointer-events: none` so the overlay never steals clicks.
 */
export function HUD({ store }: HUDProps) {
  const init = useStore(store, (s) => s.init);
  const shootout = useStore(store, (s) => s.shootout);
  const commentary = useStore(store, (s) => s.commentary);
  const lastEvent = useStore(store, (s) => s.events[s.events.length - 1] ?? null);

  if (!init) {
    return (
      <div className="hud hud-loading">
        <div className="hud-card">Connecting…</div>
      </div>
    );
  }

  return (
    <div className="hud" data-testid="hud">
      {shootout.active || shootout.ended ? (
        <div className="hud-shootout" data-testid="shootout">
          <div className="hud-shootout-label">Penalty shootout</div>
          <div className="hud-shootout-score">
            <span data-testid="shootout-home">{shootout.home}</span>
            <span> &middot; </span>
            <span data-testid="shootout-away">{shootout.away}</span>
          </div>
          {shootout.ended ? <div className="hud-shootout-ft">Full time</div> : null}
        </div>
      ) : null}

      {lastEvent ? (
        <div className="hud-event-banner" data-testid="event-banner">
          <span className="hud-event-type">{eventLabel(lastEvent)}</span>
        </div>
      ) : null}

      {commentary ? (
        <div className="hud-commentary" data-testid="commentary">
          {commentary}
        </div>
      ) : null}
    </div>
  );
}

function eventLabel(ev: import("@tournamental/spec").EventMessage): string {
  switch (ev.type) {
    case "event.goal":
      return "GOAL";
    case "event.shot":
      return "SHOT";
    case "event.tackle":
      return ev.success ? "TACKLE" : "TACKLE attempt";
    case "event.foul":
      return `FOUL (${ev.severity})`;
    case "event.save":
      return "SAVE";
    case "event.penalty_shootout_start":
      return "Penalty shootout";
    case "event.penalty_attempt":
      return `Penalty: ${ev.outcome}`;
    case "event.penalty_shootout_end":
      return "Shootout decided";
    case "event.kickoff":
      return "Kickoff";
    case "event.period_start":
      return `Period ${ev.period} start`;
    case "event.period_end":
      return `Period ${ev.period} end`;
    case "event.match_end":
      return "Full time";
    case "event.commentary":
      return "";
    case "event.substitution":
      return "Substitution";
    case "event.score_change":
      return "";
    case "event.out_of_bounds":
      return ev.restart;
    case "event.pass":
    default:
      return "";
  }
}
