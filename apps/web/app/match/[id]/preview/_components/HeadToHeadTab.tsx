/**
 * H2H tab, three-up summary (home wins, draws, away wins) at the top,
 * then a list of recent meetings (date, score, competition, location).
 *
 * Direction-insensitive: the `H2HRecord` always has `homeWins` /
 * `awayWins` from the perspective of the codes the page passed in
 * (homeCode / awayCode of the current match), so the summary is
 * already correctly oriented.
 */

"use client";

import { TeamFlag } from "@/components/bracket/TeamFlag";

import type { H2HRecord } from "../_lib/match-data";

export interface HeadToHeadTabProps {
  readonly h2h: H2HRecord | null;
  readonly homeName: string;
  readonly awayName: string;
  readonly homeCode?: string;
  readonly awayCode?: string;
}

export function HeadToHeadTab(props: HeadToHeadTabProps) {
  const { h2h, homeName, awayName, homeCode, awayCode } = props;

  if (!h2h || !homeCode || !awayCode) {
    return (
      <div className="mp-tab-content mp-h2h-empty">
        <p className="mp-empty-headline">No head-to-head record available.</p>
        <p className="mp-empty-hint">
          {!homeCode || !awayCode
            ? "Both teams must be confirmed before head-to-head data can render."
            : "These two teams haven't met before."}
        </p>
      </div>
    );
  }

  return (
    <div className="mp-tab-content mp-h2h">
      <div className="mp-h2h-summary" role="group" aria-label="Head-to-head summary">
        <div className="mp-h2h-cell mp-h2h-cell-home">
          <TeamFlag
            code={homeCode}
            name={homeName}
            size="md"
            shape="circle"
            sparkle={false}
          />
          <span className="mp-h2h-stat">{h2h.homeWins}</span>
          <span className="mp-h2h-label">{homeName} wins</span>
        </div>
        <div className="mp-h2h-cell mp-h2h-cell-draw">
          <span className="mp-h2h-draw-icon" aria-hidden="true">=</span>
          <span className="mp-h2h-stat">{h2h.draws}</span>
          <span className="mp-h2h-label">Draws</span>
        </div>
        <div className="mp-h2h-cell mp-h2h-cell-away">
          <TeamFlag
            code={awayCode}
            name={awayName}
            size="md"
            shape="circle"
            sparkle={false}
          />
          <span className="mp-h2h-stat">{h2h.awayWins}</span>
          <span className="mp-h2h-label">{awayName} wins</span>
        </div>
      </div>

      {h2h.stub && (
        <p className="mp-h2h-stub-note">
          Showing illustrative meetings - real historical data wires soon.
        </p>
      )}

      <ul className="mp-h2h-list" aria-label="Recent meetings">
        {h2h.meetings.map((m, i) => {
          const dt = new Date(m.date);
          const date = isFinite(dt.getTime())
            ? dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
            : m.date;
          return (
            <li key={`${m.date}-${i}`} className="mp-h2h-row">
              <span className="mp-h2h-row-date">{date}</span>
              <span className="mp-h2h-row-score">
                <span className="mp-h2h-row-team">{m.homeCode}</span>
                <span className="mp-h2h-row-num">{m.homeScore}</span>
                <span className="mp-h2h-row-sep" aria-hidden="true">-</span>
                <span className="mp-h2h-row-num">{m.awayScore}</span>
                <span className="mp-h2h-row-team">{m.awayCode}</span>
                {m.penalties && (
                  <span className="mp-h2h-row-pens" title="Penalties">
                    ({m.penalties})
                  </span>
                )}
              </span>
              <span className="mp-h2h-row-comp">{m.competition}</span>
              {m.venue && <span className="mp-h2h-row-venue">{m.venue}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
