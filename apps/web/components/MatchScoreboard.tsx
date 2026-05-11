"use client";

import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { MatchStore } from "@tournamental/spec-client";
import { formatMatchMinute } from "@/lib/match-stats";
import { fifaCodeToFlagEmoji } from "@/lib/team-flag";

interface MatchScoreboardProps {
  store: StoreApi<MatchStore>;
}

/**
 * Broadcast-style centred scoreboard.
 *
 * One pill, three columns:
 *
 *   [ flag  HOME-NAME  HOME-SCORE ] [ 37' 1H ] [ AWAY-SCORE  AWAY-NAME  flag ]
 *
 * Sits centred at the top of the canvas with a backdrop-filter blur and
 * the same dark-navy + gold accent palette used on the molecule view.
 * Period label sits above the clock in small caps. On goals the
 * MatchStatsHUD GOAL burst still fires; this component only renders the
 * persistent score state.
 */
export function MatchScoreboard({ store }: MatchScoreboardProps) {
  const init = useStore(store, (s) => s.init);
  const score = useStore(store, (s) => s.score);
  const period = useStore(store, (s) => s.period);
  const clockDisplay = useStore(store, (s) => s.clockDisplay);
  const curr = useStore(store, (s) => s.curr);
  const shootout = useStore(store, (s) => s.shootout);

  if (!init) return null;

  const home = init.teams[0];
  const away = init.teams[1];
  const homeName = home?.short_name ?? home?.name ?? "HOME";
  const awayName = away?.short_name ?? away?.name ?? "AWAY";
  const homeColour = home?.kit.primary ?? "#6cabdd";
  const awayColour = away?.kit.primary ?? "#f3b83b";
  const homeFlag = fifaCodeToFlagEmoji(home?.id);
  const awayFlag = fifaCodeToFlagEmoji(away?.id);

  const playheadMs = curr?.t ?? 0;
  const liveMinute =
    period === 5
      ? "PEN"
      : clockDisplay ?? formatMatchMinute(Math.floor(playheadMs / 1000));

  return (
    <div
      className="match-scoreboard"
      data-testid="match-scoreboard"
      role="status"
      aria-live="polite"
    >
      <div
        className="msb-side msb-home"
        style={{ "--team-colour": homeColour } as React.CSSProperties}
        data-testid="msb-home"
      >
        {homeFlag ? (
          <span className="msb-flag" aria-hidden>
            {homeFlag}
          </span>
        ) : null}
        <span className="msb-name" data-testid="msb-home-name">
          {homeName}
        </span>
        <span className="msb-score" data-testid="msb-home-score">
          {score.home}
        </span>
      </div>

      <div className="msb-clock" data-testid="msb-clock">
        <div className="msb-period">{periodLabel(period)}</div>
        <div className="msb-clock-display">{liveMinute}</div>
        {shootout.active || shootout.ended ? (
          <div className="msb-shootout" data-testid="msb-shootout">
            <span>{shootout.home}</span>
            <span className="msb-shootout-dot">·</span>
            <span>{shootout.away}</span>
          </div>
        ) : null}
      </div>

      <div
        className="msb-side msb-away"
        style={{ "--team-colour": awayColour } as React.CSSProperties}
        data-testid="msb-away"
      >
        <span className="msb-score" data-testid="msb-away-score">
          {score.away}
        </span>
        <span className="msb-name" data-testid="msb-away-name">
          {awayName}
        </span>
        {awayFlag ? (
          <span className="msb-flag" aria-hidden>
            {awayFlag}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function periodLabel(p: number): string {
  switch (p) {
    case 1:
      return "1H";
    case 2:
      return "2H";
    case 3:
      return "ET1";
    case 4:
      return "ET2";
    case 5:
      return "PEN";
    default:
      return p > 0 ? `P${p}` : "-";
  }
}
