"use client";

import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { MatchStore } from "@vtorn/spec-client";

interface HUDProps {
  store: StoreApi<MatchStore>;
}

/**
 * 2D overlay HUD. Subscribes to the slow-changing slices of the store
 * (score, clock, latest commentary) and renders a fixed overlay above the
 * R3F canvas. `pointer-events: none` so the overlay never steals clicks.
 *
 * Per acceptance: when fed AR-FR, this displays 3-3 (regulation+ET) and
 * 4-2 in the shootout panel.
 */
export function HUD({ store }: HUDProps) {
  const init = useStore(store, (s) => s.init);
  const score = useStore(store, (s) => s.score);
  const shootout = useStore(store, (s) => s.shootout);
  const period = useStore(store, (s) => s.period);
  const clock = useStore(store, (s) => s.clockDisplay);
  const commentary = useStore(store, (s) => s.commentary);
  const lastEvent = useStore(store, (s) => s.events[s.events.length - 1] ?? null);

  if (!init) {
    return (
      <div className="hud hud-loading">
        <div className="hud-card">Connecting…</div>
      </div>
    );
  }

  const home = init.teams[0];
  const away = init.teams[1];

  return (
    <div className="hud" data-testid="hud">
      <div className="hud-scoreboard">
        <div className="hud-team home" style={{ borderColor: home.kit.primary }}>
          <span className="hud-team-name">{home.short_name ?? home.name}</span>
          <span className="hud-team-score" data-testid="home-score">{score.home}</span>
        </div>
        <div className="hud-clock">
          <div className="hud-period">{periodLabel(period)}</div>
          <div className="hud-clock-display" data-testid="clock">{clock ?? "0:00"}</div>
        </div>
        <div className="hud-team away" style={{ borderColor: away.kit.primary }}>
          <span className="hud-team-score" data-testid="away-score">{score.away}</span>
          <span className="hud-team-name">{away.short_name ?? away.name}</span>
        </div>
      </div>

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

function periodLabel(p: number): string {
  switch (p) {
    case 1:
      return "1st half";
    case 2:
      return "2nd half";
    case 3:
      return "ET 1";
    case 4:
      return "ET 2";
    case 5:
      return "Penalties";
    default:
      return `Period ${p}`;
  }
}

function eventLabel(ev: import("@vtorn/spec").EventMessage): string {
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
