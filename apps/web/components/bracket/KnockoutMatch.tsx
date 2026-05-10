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
 *
 * Visual contract (per [doc 46](../../../docs/46-knockout-flag-backgrounds.md)):
 *   - Idle side: dark cell, mid-size flag chip, dim opacity.
 *   - Hover/focus side (mouse, no reduced-motion): preview the flag at
 *     ~28% opacity behind the dark cell, hinting "this is what selecting
 *     looks like".
 *   - Selected side: full-bleed team flag as the cell's background-image
 *     with a vertical 0.15→0.65 dark gradient overlay so the team name
 *     and odds remain ≥4.5:1 contrast against any flag region.
 */

"use client";

import type { CSSProperties, MouseEvent } from "react";

import type { CascadedKnockout, MatchPrediction, Team } from "@vtorn/bracket-engine";

import { useOptionalOverlay } from "@/components/overlay/OverlayProvider";
import { OddsChip } from "../odds/OddsChip";
import { TeamFlag } from "./TeamFlag";

export interface KnockoutMatchProps {
  readonly knockout: CascadedKnockout;
  readonly teams: ReadonlyMap<string, Team>;
  readonly prediction?: MatchPrediction;
  /** Cloudflare-derived 2-letter country code; gates the affiliate
   * CTA in the hover card. */
  readonly country?: string | null;
  /** When false, suppress the live-odds chip (used by tests). */
  readonly showOddsChip?: boolean;
  readonly onChange: (next: MatchPrediction) => void;
}

export function KnockoutMatch(props: KnockoutMatchProps) {
  const { knockout, teams, prediction, country, showOddsChip = true, onChange } = props;

  const homeTeam = knockout.home.team ? teams.get(knockout.home.team) : undefined;
  const awayTeam = knockout.away.team ? teams.get(knockout.away.team) : undefined;
  const slotsKnown = !!homeTeam && !!awayTeam;

  const overlay = useOptionalOverlay();
  const openTeamOverlay = (code: string) => (e: MouseEvent): void => {
    if (!overlay) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    overlay.open("team", { code });
  };
  const openMatchOverlay = (e: MouseEvent): void => {
    if (!overlay) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    overlay.open("match", { id: knockout.id });
  };

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

  // Apply the flag as the cell background regardless of selection state.
  // The selected side gets a thicker accent border + brighter scrim; the
  // unselected side gets a heavier dark scrim + reduced opacity to read
  // as clearly inactive. (See bracket.css for both treatments.)
  const homeBgStyle: CSSProperties | undefined = homeTeam
    ? { backgroundImage: `url(/flags/${homeTeam.id}.svg)` }
    : undefined;
  const awayBgStyle: CSSProperties | undefined = awayTeam
    ? { backgroundImage: `url(/flags/${awayTeam.id}.svg)` }
    : undefined;

  const homePreview: CSSProperties | undefined = undefined;
  const awayPreview: CSSProperties | undefined = undefined;

  return (
    <div className="km-card" data-match-id={knockout.id} style={accent}>
      <header className="km-card-header">
        <span className="km-no" aria-label={`${knockout.stage.toUpperCase()} match number`}>
          {knockout.stage.toUpperCase()} #{knockout.match_no}
        </span>
        <a
          href={`/match/${knockout.id}/preview`}
          className="km-view-link"
          aria-label={`View match preview for ${knockout.id.toUpperCase()}`}
          title="View match preview"
          onClick={(e) => {
            e.stopPropagation();
            openMatchOverlay(e);
          }}
        >
          <span aria-hidden="true">→</span>
          <span className="km-view-link-label">View</span>
        </a>
      </header>
      <button
        type="button"
        className={`km-team km-home ${homeWin ? "is-winner" : ""}`}
        onClick={() => choose("home")}
        disabled={!slotsKnown}
        aria-pressed={homeWin}
        aria-label={
          homeTeam
            ? `${homeTeam.name} — ${homeWin ? "currently picked to advance" : "pick to advance"} from ${knockout.stage.toUpperCase()} #${knockout.match_no}`
            : "Home slot to be determined"
        }
        style={{ ...(homeBgStyle ?? {}), ...(homePreview ?? {}) }}
      >
        {homeTeam ? (
          <>
            <TeamFlag
              code={homeTeam.id}
              name={homeTeam.name}
              accentColor={homeTeam.kit?.primary}
              size="md"
              sparkle={homeWin}
              dim={!homeWin && awayWin}
            />
            <span className="km-team-name">{homeTeam.name}</span>
            {overlay && (
              <a
                href={`/team/${homeTeam.id}`}
                className="km-team-info"
                aria-label={`Open ${homeTeam.name} team overlay`}
                title={`${homeTeam.name} info`}
                onClick={openTeamOverlay(homeTeam.id)}
              >
                i
              </a>
            )}
          </>
        ) : (
          <span className="km-tbd">{describeSource(knockout.home.source)}</span>
        )}
      </button>
      <span className="km-connector" aria-hidden="true" />
      <button
        type="button"
        className={`km-team km-away ${awayWin ? "is-winner" : ""}`}
        onClick={() => choose("away")}
        disabled={!slotsKnown}
        aria-pressed={awayWin}
        aria-label={
          awayTeam
            ? `${awayTeam.name} — ${awayWin ? "currently picked to advance" : "pick to advance"} from ${knockout.stage.toUpperCase()} #${knockout.match_no}`
            : "Away slot to be determined"
        }
        style={{ ...(awayBgStyle ?? {}), ...(awayPreview ?? {}) }}
      >
        {awayTeam ? (
          <>
            <TeamFlag
              code={awayTeam.id}
              name={awayTeam.name}
              accentColor={awayTeam.kit?.primary}
              size="md"
              sparkle={awayWin}
              dim={!awayWin && homeWin}
            />
            <span className="km-team-name">{awayTeam.name}</span>
            {overlay && (
              <a
                href={`/team/${awayTeam.id}`}
                className="km-team-info"
                aria-label={`Open ${awayTeam.name} team overlay`}
                title={`${awayTeam.name} info`}
                onClick={openTeamOverlay(awayTeam.id)}
              >
                i
              </a>
            )}
          </>
        ) : (
          <span className="km-tbd">{describeSource(knockout.away.source)}</span>
        )}
      </button>
      {showOddsChip && slotsKnown && homeTeam && awayTeam && (
        <div className="km-odds" data-km-odds="">
          <OddsChip
            matchNo={knockout.id}
            homeTeam={homeTeam.id}
            awayTeam={awayTeam.id}
            homeLabel={homeTeam.name}
            awayLabel={awayTeam.name}
            noDraw
            groupLabel={knockout.stage.toUpperCase()}
            country={country}
            source="bracket-knockout"
          />
        </div>
      )}
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
