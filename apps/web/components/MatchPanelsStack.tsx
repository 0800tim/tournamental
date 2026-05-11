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
import { CollapsibleHUDCard } from "./CollapsibleHUDCard";

interface MatchPanelsStackProps {
  store: StoreApi<MatchStore>;
}

/**
 * Right-edge stack of broadcast panels: scorers, stats, subs.
 *
 * Each panel is wrapped in a CollapsibleHUDCard so the player can
 * expand the ones they care about and keep the pitch view clear.
 * Default state on first visit: all three collapsed.
 *
 * Also renders the centred goal-burst overlay because the burst data
 * pipeline lives next to the stats compute (we'd otherwise compute it
 * twice). The burst is positioned absolutely outside the stack so it
 * pops over the canvas.
 */
export function MatchPanelsStack({ store }: MatchPanelsStackProps) {
  const init = useStore(store, (s) => s.init);
  const events = useStore(store, (s) => s.events);
  const curr = useStore(store, (s) => s.curr);
  const playheadMs = curr?.t ?? 0;

  const stats = useMemo<MatchStats>(
    () => computeMatchStats(init, events, { t: playheadMs }),
    [init, events, playheadMs],
  );

  // Goal-celebration burst, fires once per new goal (keyed by matchSec).
  const lastBurstMatchSec = stats.mostRecentGoal?.matchSec ?? null;
  const [burst, setBurst] = useState<ScorerEntry | null>(null);
  useEffect(() => {
    if (!stats.mostRecentGoal) return;
    setBurst(stats.mostRecentGoal);
    const id = setTimeout(() => setBurst(null), GOAL_BURST_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBurstMatchSec]);

  if (!init) return null;

  return (
    <>
      <aside
        className="match-hud-stack"
        data-testid="match-hud-stack"
        aria-label="Match information"
      >
        <CollapsibleHUDCard
          id="scorers"
          title="Scorers"
          icon={<span className="hud-card-dot" data-tone="gold" />}
          empty={stats.scorers.length === 0}
        >
          <ScorersList
            scorers={stats.scorers}
            init={init}
          />
        </CollapsibleHUDCard>

        <CollapsibleHUDCard
          id="stats"
          title="Match stats"
          icon={<span className="hud-card-dot" data-tone="blue" />}
        >
          <StatsTable stats={stats} />
        </CollapsibleHUDCard>

        <CollapsibleHUDCard
          id="subs"
          title="Substitutions"
          icon={<span className="hud-card-dot" data-tone="silver" />}
          empty={stats.subs.length === 0}
        >
          <SubsList subs={stats.subs} />
        </CollapsibleHUDCard>
      </aside>

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
            {burst.scoreAfter.home} – {burst.scoreAfter.away}
          </div>
        </div>
      ) : null}
    </>
  );
}

const GOAL_BURST_MS = 3500;

function ScorersList({
  scorers,
  init,
}: {
  scorers: MatchStats["scorers"];
  init: import("@vtorn/spec").MatchInit;
}) {
  if (scorers.length === 0) {
    return (
      <p className="hud-card-empty" data-testid="msh-scorers-empty">
        No goals yet.
      </p>
    );
  }
  return (
    <ul className="msh-scorers-list" data-testid="msh-scorers">
      {scorers.map((s, i) => (
        <li
          key={`${s.matchSec}-${s.playerId}-${i}`}
          data-testid="msh-scorer-row"
          data-side={s.side}
        >
          <span className="msh-scorer-min">{formatMatchMinute(s.matchSec)}</span>
          <span className="msh-scorer-name" data-testid="msh-scorer-name">
            {s.playerName}
            {s.isPenalty ? " pen" : ""}
          </span>
          <span className="msh-scorer-team" data-testid="msh-scorer-team">
            {sideToTeam(init, s.side)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StatsTable({ stats }: { stats: MatchStats }) {
  return (
    <div className="msh-stats-table" data-testid="msh-stats">
      <StatRow
        label="Possession"
        home={`${formatPossession(stats.home.possession)}%`}
        away={`${formatPossession(stats.away.possession)}%`}
        homePct={stats.home.possession}
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
  );
}

function SubsList({ subs }: { subs: MatchStats["subs"] }) {
  if (subs.length === 0) {
    return (
      <p className="hud-card-empty" data-testid="msh-subs-empty">
        No substitutions yet.
      </p>
    );
  }
  return (
    <ul className="msh-subs-list" data-testid="msh-subs">
      {subs.map((s, i) => (
        <li
          key={`${s.matchSec}-${s.playerInId}-${i}`}
          data-testid="msh-sub-row"
          data-side={s.side}
        >
          <span className="msh-sub-min">{formatMatchMinute(s.matchSec)}</span>
          <span className="msh-sub-arrow msh-sub-in" aria-label="on">↑</span>
          <span className="msh-sub-name">{s.playerInName}</span>
          <span className="msh-sub-arrow msh-sub-out-arrow" aria-label="off">↓</span>
          <span className="msh-sub-name msh-sub-out">{s.playerOutName}</span>
        </li>
      ))}
    </ul>
  );
}

interface StatRowProps {
  label: string;
  home: number | string;
  away: number | string;
  /** Optional 0..1 for the possession bar visual. */
  homePct?: number;
  testid: string;
}

function StatRow({ label, home, away, homePct, testid }: StatRowProps) {
  return (
    <div className="msh-stat-row" data-testid={testid}>
      <span className="msh-stat-home">{home}</span>
      <span className="msh-stat-label">{label}</span>
      <span className="msh-stat-away">{away}</span>
      {homePct !== undefined ? (
        <div className="msh-stat-bar" aria-hidden>
          <span
            className="msh-stat-bar-home"
            style={{ width: `${Math.max(0, Math.min(100, homePct * 100))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function sideToTeam(
  init: import("@vtorn/spec").MatchInit,
  side: "home" | "away",
): string {
  const team = side === "home" ? init.teams[0] : init.teams[1];
  return team.short_name ?? team.name;
}
