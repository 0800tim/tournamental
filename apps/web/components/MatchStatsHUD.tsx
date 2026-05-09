"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { MatchStore } from "@vtorn/spec-client";
import {
  computeMatchStats,
  formatMatchMinute,
  formatPossession,
  type MatchStats,
  type ScorerEntry,
} from "@/lib/match-stats";

interface MatchStatsHUDProps {
  store: StoreApi<MatchStore>;
}

type MobileTab = "score" | "stats" | "scorers" | "subs";

/**
 * Broadcast-style match-stats HUD overlay.
 *
 * Per Tim's spec:
 *
 *   - Top-left:    flag-coded scoreboard + minute (replaces the old
 *                  centred shrunken pill, which is what he was looking
 *                  at on his phone when the score wasn't updating).
 *   - Top-right:   chronological scorers ticker — `36' Di María (ARG)`,
 *                  `80' Mbappé pen (FRA)`, etc.
 *   - Bottom-left: stats panel — possession, shots, shots-on-target,
 *                  corners, fouls, yellows, reds. Aggregates from
 *                  `computeMatchStats(events, frames, t)`.
 *   - Bottom-right: substitutions ticker.
 *   - Goal moment: when a goal fires the most-recent scorer chip
 *                  enlarges for ~3.5 s.
 *
 * On portrait phones (≤ 640 px) we collapse to a bottom drawer with a
 * tab toggle so the pitch is never blocked.
 */
export function MatchStatsHUD({ store }: MatchStatsHUDProps) {
  const init = useStore(store, (s) => s.init);
  const events = useStore(store, (s) => s.events);
  const score = useStore(store, (s) => s.score);
  const period = useStore(store, (s) => s.period);
  const clockDisplay = useStore(store, (s) => s.clockDisplay);
  const curr = useStore(store, (s) => s.curr);
  const playheadMs = curr?.t ?? 0;

  // Compose the stats panel. Computed in a useMemo on (events, t) —
  // events is a bounded ring buffer in the store, so this is cheap.
  const stats = useMemo<MatchStats>(
    () => computeMatchStats(init, events, { t: playheadMs }),
    [init, events, playheadMs],
  );

  const homeName = init?.teams[0]?.short_name ?? init?.teams[0]?.name ?? "HOME";
  const awayName = init?.teams[1]?.short_name ?? init?.teams[1]?.name ?? "AWAY";
  const homeColour = init?.teams[0]?.kit.primary ?? "#6cabdd";
  const awayColour = init?.teams[1]?.kit.primary ?? "#f3b83b";

  // Goal-celebration state — the most recent scorer chip enlarges for
  // GOAL_BURST_MS after a goal fires, then settles back into the
  // ticker. We watch `mostRecentGoal.matchSec` so any backward scrub
  // past the goal naturally hides the burst.
  const lastBurstMatchSec = stats.mostRecentGoal?.matchSec ?? null;
  const [burst, setBurst] = useState<ScorerEntry | null>(null);
  useEffect(() => {
    if (!stats.mostRecentGoal) return;
    setBurst(stats.mostRecentGoal);
    const id = setTimeout(() => setBurst(null), GOAL_BURST_MS);
    return () => clearTimeout(id);
    // The burst should fire ONCE per new goal, keyed by matchSec.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBurstMatchSec]);

  // Mobile drawer state: which tab is active. Defaults to the
  // scoreboard so first-paint shows the most important info.
  const [mobileTab, setMobileTab] = useState<MobileTab>("score");

  if (!init) return null;

  const liveMinute = period === 5
    ? "Pens"
    : (clockDisplay ?? formatMatchMinute(Math.floor(playheadMs / 1000)));

  return (
    <div className="match-stats-hud" data-testid="match-stats-hud">
      {/* ---- top-left: scoreboard ---- */}
      <div
        className="msh-scoreboard"
        data-testid="msh-scoreboard"
        role="status"
        aria-live="polite"
      >
        <div className="msh-team msh-home">
          <span
            className="msh-team-stripe"
            style={{ background: homeColour }}
            aria-hidden
          />
          <span className="msh-team-name" data-testid="msh-home-name">
            {homeName}
          </span>
          <span className="msh-team-score" data-testid="msh-home-score">
            {score.home}
          </span>
        </div>
        <div className="msh-clock">
          <div className="msh-period">{periodLabel(period)}</div>
          <div className="msh-clock-display" data-testid="msh-clock">
            {liveMinute}
          </div>
        </div>
        <div className="msh-team msh-away">
          <span className="msh-team-score" data-testid="msh-away-score">
            {score.away}
          </span>
          <span className="msh-team-name" data-testid="msh-away-name">
            {awayName}
          </span>
          <span
            className="msh-team-stripe"
            style={{ background: awayColour }}
            aria-hidden
          />
        </div>
      </div>

      {/* ---- top-right: scorers ticker ---- */}
      <div
        className="msh-scorers"
        data-testid="msh-scorers"
        data-empty={stats.scorers.length === 0 ? "1" : "0"}
        aria-label="Scorers"
      >
        <div className="msh-panel-label">Scorers</div>
        <ul>
          {stats.scorers.map((s, i) => (
            <li
              key={`${s.matchSec}-${s.playerId}-${i}`}
              data-testid="msh-scorer-row"
              data-side={s.side}
            >
              <span className="msh-scorer-min">
                {formatMatchMinute(s.matchSec)}
              </span>
              <span
                className="msh-scorer-name"
                data-testid="msh-scorer-name"
              >
                {s.playerName}
                {s.isPenalty ? " pen" : ""}
              </span>
              <span className="msh-scorer-team" data-testid="msh-scorer-team">
                ({sideToTeam(init, s.side)})
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* ---- bottom-left: stats panel ---- */}
      <div
        className="msh-stats"
        data-testid="msh-stats"
        aria-label="Match statistics"
      >
        <div className="msh-panel-label">Match stats</div>
        <StatRow
          label="Possession"
          home={`${formatPossession(stats.home.possession)}%`}
          away={`${formatPossession(stats.away.possession)}%`}
          testid="msh-stat-possession"
        />
        <StatRow
          label="Shots"
          home={stats.home.shots}
          away={stats.away.shots}
          testid="msh-stat-shots"
        />
        <StatRow
          label="On target"
          home={stats.home.shotsOnTarget}
          away={stats.away.shotsOnTarget}
          testid="msh-stat-shots-on-target"
        />
        <StatRow
          label="Corners"
          home={stats.home.corners}
          away={stats.away.corners}
          testid="msh-stat-corners"
        />
        <StatRow
          label="Fouls"
          home={stats.home.fouls}
          away={stats.away.fouls}
          testid="msh-stat-fouls"
        />
        <StatRow
          label="Yellow"
          home={stats.home.yellows}
          away={stats.away.yellows}
          testid="msh-stat-yellows"
        />
        <StatRow
          label="Red"
          home={stats.home.reds}
          away={stats.away.reds}
          testid="msh-stat-reds"
        />
        <StatRow
          label="Saves"
          home={stats.home.saves}
          away={stats.away.saves}
          testid="msh-stat-saves"
        />
      </div>

      {/* ---- bottom-right: substitutions ticker ---- */}
      <div
        className="msh-subs"
        data-testid="msh-subs"
        data-empty={stats.subs.length === 0 ? "1" : "0"}
        aria-label="Substitutions"
      >
        <div className="msh-panel-label">Subs</div>
        <ul>
          {stats.subs.map((s, i) => (
            <li
              key={`${s.matchSec}-${s.playerInId}-${i}`}
              data-testid="msh-sub-row"
              data-side={s.side}
            >
              <span className="msh-sub-min">
                {formatMatchMinute(s.matchSec)}
              </span>
              <span className="msh-sub-arrow">↑</span>
              <span className="msh-sub-name">{s.playerInName}</span>
              <span className="msh-sub-arrow">↓</span>
              <span className="msh-sub-name msh-sub-out">
                {s.playerOutName}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* ---- centre goal-burst overlay ---- */}
      {burst ? (
        <div
          className="msh-goal-burst"
          data-testid="msh-goal-burst"
          role="status"
          aria-live="assertive"
        >
          <div className="msh-goal-burst-label">GOAL</div>
          <div className="msh-goal-burst-name">{burst.playerName}</div>
          <div className="msh-goal-burst-min">
            {formatMatchMinute(burst.matchSec)}
          </div>
          <div className="msh-goal-burst-score">
            {burst.scoreAfter.home} - {burst.scoreAfter.away}
          </div>
        </div>
      ) : null}

      {/* ---- mobile bottom-drawer tabs ---- */}
      <div
        className="msh-mobile-tabs"
        data-testid="msh-mobile-tabs"
        data-active={mobileTab}
      >
        <button
          type="button"
          data-active={mobileTab === "score" ? "1" : "0"}
          onClick={() => setMobileTab("score")}
        >
          Score
        </button>
        <button
          type="button"
          data-active={mobileTab === "stats" ? "1" : "0"}
          onClick={() => setMobileTab("stats")}
        >
          Stats
        </button>
        <button
          type="button"
          data-active={mobileTab === "scorers" ? "1" : "0"}
          onClick={() => setMobileTab("scorers")}
        >
          Scorers
        </button>
        <button
          type="button"
          data-active={mobileTab === "subs" ? "1" : "0"}
          onClick={() => setMobileTab("subs")}
        >
          Subs
        </button>
      </div>
    </div>
  );
}

/** Goal-celebration burst duration. */
const GOAL_BURST_MS = 3500;

interface StatRowProps {
  label: string;
  home: number | string;
  away: number | string;
  testid: string;
}

function StatRow({ label, home, away, testid }: StatRowProps) {
  return (
    <div className="msh-stat-row" data-testid={testid}>
      <span className="msh-stat-home">{home}</span>
      <span className="msh-stat-label">{label}</span>
      <span className="msh-stat-away">{away}</span>
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
      return `P${p}`;
  }
}

function sideToTeam(
  init: import("@vtorn/spec").MatchInit,
  side: "home" | "away",
): string {
  const team = side === "home" ? init.teams[0] : init.teams[1];
  return team.short_name ?? team.name;
}
