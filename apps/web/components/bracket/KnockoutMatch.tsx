/**
 * KnockoutMatch — per-match prediction for a knockout fixture.
 *
 * Same UX shape as MatchPredictionRow but no draw option (knockouts go
 * to ET + pens; for the prediction we treat the user's pick as
 * "advances").
 *
 * The slot occupants are computed upstream from the user's group-stage
 * predictions via the cascade. While slots aren't yet filled, the buttons
 * are disabled and show "TBD".
 */

"use client";

import type { CSSProperties } from "react";

import type { CascadedKnockout, MatchPrediction, Team } from "@vtorn/bracket-engine";

import { TeamFlag } from "./TeamFlag";

export interface KnockoutMatchProps {
  readonly knockout: CascadedKnockout;
  readonly teams: ReadonlyMap<string, Team>;
  readonly prediction?: MatchPrediction;
  readonly onChange: (next: MatchPrediction) => void;
}

export function KnockoutMatch(props: KnockoutMatchProps) {
  const { knockout, teams, prediction, onChange } = props;

  const homeTeam = knockout.home.team ? teams.get(knockout.home.team) : undefined;
  const awayTeam = knockout.away.team ? teams.get(knockout.away.team) : undefined;
  const slotsKnown = !!homeTeam && !!awayTeam;

  const choose = (side: "home" | "away"): void => {
    if (!slotsKnown) return;
    onChange({
      matchId: knockout.id,
      outcome: side === "home" ? "home_win" : "away_win",
      lockedAt: new Date().toISOString(),
    });
  };

  const homeWin = prediction?.outcome === "home_win";
  const awayWin = prediction?.outcome === "away_win";

  const accent: CSSProperties = {
    "--km-home-accent": homeTeam?.kit?.primary ?? "#fbbf24",
    "--km-away-accent": awayTeam?.kit?.primary ?? "#3b82f6",
  } as CSSProperties;

  return (
    <div className="km-card" data-match-id={knockout.id} style={accent}>
      <header className="km-card-header">
        <span className="km-stage">{knockout.stage.toUpperCase()}</span>
        <span className="km-no">#{knockout.match_no}</span>
      </header>
      <button
        type="button"
        className={`km-team km-home ${homeWin ? "is-winner" : ""}`}
        onClick={() => choose("home")}
        disabled={!slotsKnown}
        aria-pressed={homeWin}
        aria-label={homeTeam ? `${homeTeam.name} advances` : "Home slot to be determined"}
      >
        {homeTeam ? (
          <>
            <TeamFlag
              code={homeTeam.id}
              name={homeTeam.name}
              accentColor={homeTeam.kit?.primary}
              size="sm"
              sparkle={homeWin}
            />
            <span className="km-team-name">{homeTeam.name}</span>
          </>
        ) : (
          <span className="km-tbd">{describeSource(knockout.home.source)}</span>
        )}
      </button>
      <span className="km-vs" aria-hidden="true">vs</span>
      <button
        type="button"
        className={`km-team km-away ${awayWin ? "is-winner" : ""}`}
        onClick={() => choose("away")}
        disabled={!slotsKnown}
        aria-pressed={awayWin}
        aria-label={awayTeam ? `${awayTeam.name} advances` : "Away slot to be determined"}
      >
        {awayTeam ? (
          <>
            <TeamFlag
              code={awayTeam.id}
              name={awayTeam.name}
              accentColor={awayTeam.kit?.primary}
              size="sm"
              sparkle={awayWin}
            />
            <span className="km-team-name">{awayTeam.name}</span>
          </>
        ) : (
          <span className="km-tbd">{describeSource(knockout.away.source)}</span>
        )}
      </button>
    </div>
  );
}

function describeSource(s: CascadedKnockout["home"]["source"]): string {
  switch (s.kind) {
    case "group_position":
      return `Pos ${s.position} group ${s.group}`;
    case "best_third":
      return `Best 3rd #${s.rank}`;
    case "best_fourth":
      return `Best 4th #${s.rank}`;
    case "knockout_winner":
      return `Winner ${s.match_id}`;
    case "knockout_loser":
      return `Loser ${s.match_id}`;
  }
}
