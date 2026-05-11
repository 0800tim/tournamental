/**
 * Stats tab, pre-match expected stats (xG, possession, shots) and
 * season-average per team in a compact data-table.
 *
 * Presented as two stacked rows:
 *   1. Pre-match expected (xG / possession / shots) - for THIS match.
 *   2. Season averages per team - for context.
 *
 * Each metric is rendered as a horizontal team-coloured bar pair so the
 * comparison is at-a-glance. Inspired by FotMob's team-coloured stat
 * bars (per docs/35-competitor-ux-dossier.md §4).
 */

"use client";

import type { ExpectedScoreline, TeamStats } from "../_lib/match-data";

export interface StatsTabProps {
  readonly homeName: string;
  readonly awayName: string;
  readonly homeCode?: string;
  readonly awayCode?: string;
  readonly homeStats: TeamStats | null;
  readonly awayStats: TeamStats | null;
  readonly expected: ExpectedScoreline | null;
}

export function StatsTab(props: StatsTabProps) {
  const { homeName, awayName, homeCode, awayCode, homeStats, awayStats, expected } = props;

  if (!homeCode || !awayCode || !homeStats || !awayStats || !expected) {
    return (
      <div className="mp-tab-content mp-stats-empty">
        <p className="mp-empty-headline">
          Stats unlock once both teams are confirmed.
        </p>
      </div>
    );
  }

  const stub = homeStats.stub || awayStats.stub;

  return (
    <div className="mp-tab-content mp-stats">
      <h3 className="mp-stats-section-title">Pre-match expected</h3>
      <table className="mp-stats-table" aria-label="Pre-match expected stats">
        <thead>
          <tr>
            <th scope="col" className="mp-stats-team">{homeName}</th>
            <th scope="col" className="mp-stats-metric">Metric</th>
            <th scope="col" className="mp-stats-team">{awayName}</th>
          </tr>
        </thead>
        <tbody>
          <StatRow label="Expected goals (xG)" home={expected.homeXg} away={expected.awayXg} />
          <StatRow
            label="Expected possession %"
            home={expected.homePossession}
            away={expected.awayPossession}
            unit="%"
          />
          <StatRow label="Expected shots" home={expected.homeShots} away={expected.awayShots} />
        </tbody>
      </table>

      <h3 className="mp-stats-section-title">Season averages (per match)</h3>
      <table className="mp-stats-table" aria-label="Season-average stats">
        <tbody>
          <StatRow label="xG" home={homeStats.xg_per_match} away={awayStats.xg_per_match} />
          <StatRow label="xG against" home={homeStats.xga_per_match} away={awayStats.xga_per_match} reverse />
          <StatRow
            label="Possession"
            home={homeStats.possession_pct}
            away={awayStats.possession_pct}
            unit="%"
          />
          <StatRow label="Shots" home={homeStats.shots_per_match} away={awayStats.shots_per_match} />
          <StatRow
            label="Shots on target"
            home={homeStats.shots_on_target_per_match}
            away={awayStats.shots_on_target_per_match}
          />
          <StatRow
            label="Pass accuracy"
            home={homeStats.pass_accuracy_pct}
            away={awayStats.pass_accuracy_pct}
            unit="%"
          />
          <StatRow label="Form rating" home={homeStats.form_rating} away={awayStats.form_rating} />
        </tbody>
      </table>

      {stub && (
        <p className="mp-stats-stub-note">
          Showing illustrative numbers - season-aggregate data wires soon.
        </p>
      )}
    </div>
  );
}

interface StatRowProps {
  readonly label: string;
  readonly home: number;
  readonly away: number;
  readonly unit?: "%" | "";
  /** When true, lower is better (e.g. xG against). Flips the bar
   * highlighting so the smaller number gets the brighter bar. */
  readonly reverse?: boolean;
}

function StatRow({ label, home, away, unit = "", reverse }: StatRowProps) {
  const total = Math.max(home + away, 0.01);
  const homeFrac = home / total;
  const awayFrac = away / total;
  const homeIsBetter = reverse ? home < away : home > away;
  const awayIsBetter = !homeIsBetter && home !== away;
  return (
    <tr className="mp-stats-row">
      <td className="mp-stats-cell mp-stats-cell-home" aria-label={`${label} home value`}>
        <span className={`mp-stats-num ${homeIsBetter ? "is-leader" : ""}`}>
          {home}
          {unit}
        </span>
        <span
          className="mp-stats-bar mp-stats-bar-home"
          style={{ width: `${homeFrac * 100}%` }}
          aria-hidden="true"
        />
      </td>
      <td className="mp-stats-cell mp-stats-cell-label">{label}</td>
      <td className="mp-stats-cell mp-stats-cell-away" aria-label={`${label} away value`}>
        <span
          className="mp-stats-bar mp-stats-bar-away"
          style={{ width: `${awayFrac * 100}%` }}
          aria-hidden="true"
        />
        <span className={`mp-stats-num ${awayIsBetter ? "is-leader" : ""}`}>
          {away}
          {unit}
        </span>
      </td>
    </tr>
  );
}
