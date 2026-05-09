/**
 * MatchPredictionRow — one match in the group stage with a 3-button
 * Home Win / Draw / Away Win segmented control. Optional collapsible
 * score input below.
 *
 * Keyboard: when focused, ArrowLeft/ArrowRight cycle outcome buttons,
 * 1/2/3 select home_win/draw/away_win directly.
 *
 * Pure controlled component — `onChange` fires whenever the user changes
 * outcome or scores. The parent owns the prediction map.
 */

"use client";

import { useState, type CSSProperties, type KeyboardEvent } from "react";

import type { MatchPrediction, Team } from "@vtorn/bracket-engine";

import { TeamFlag } from "./TeamFlag";

export interface MatchPredictionRowProps {
  readonly matchId: string;
  readonly homeTeam: Team;
  readonly awayTeam: Team;
  readonly prediction?: MatchPrediction;
  readonly disabled?: boolean;
  /** When true, the "Draw" option is hidden (knockout matches). */
  readonly noDraw?: boolean;
  readonly onChange: (next: MatchPrediction) => void;
}

const ALL_OUTCOMES: readonly MatchPrediction["outcome"][] = [
  "home_win",
  "draw",
  "away_win",
];

function nowIso(): string {
  return new Date().toISOString();
}

export function MatchPredictionRow(props: MatchPredictionRowProps) {
  const { matchId, homeTeam, awayTeam, prediction, disabled, noDraw, onChange } = props;
  const [showScores, setShowScores] = useState<boolean>(
    prediction?.homeScore !== undefined || prediction?.awayScore !== undefined,
  );

  const outcomes = noDraw ? ALL_OUTCOMES.filter((o) => o !== "draw") : ALL_OUTCOMES;

  const choose = (outcome: MatchPrediction["outcome"]): void => {
    if (disabled) return;
    onChange({
      matchId,
      outcome,
      homeScore: prediction?.homeScore,
      awayScore: prediction?.awayScore,
      lockedAt: nowIso(),
    });
  };

  const setScore = (side: "home" | "away", value: string): void => {
    const n = value === "" ? undefined : Math.max(0, Math.min(99, Number(value)));
    if (value !== "" && Number.isNaN(n)) return;
    onChange({
      matchId,
      outcome: prediction?.outcome ?? "home_win",
      homeScore: side === "home" ? n : prediction?.homeScore,
      awayScore: side === "away" ? n : prediction?.awayScore,
      lockedAt: nowIso(),
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return;
    if (e.key === "1") {
      e.preventDefault();
      choose("home_win");
    } else if (e.key === "2" && !noDraw) {
      e.preventDefault();
      choose("draw");
    } else if (e.key === "3" || (e.key === "2" && noDraw)) {
      e.preventDefault();
      choose("away_win");
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const cur = prediction?.outcome ?? outcomes[0]!;
      const idx = outcomes.indexOf(cur);
      const next =
        e.key === "ArrowLeft"
          ? outcomes[Math.max(0, idx - 1)]!
          : outcomes[Math.min(outcomes.length - 1, idx + 1)]!;
      e.preventDefault();
      choose(next);
    }
  };

  const homeAccent: CSSProperties = {
    "--mpr-home-accent": homeTeam.kit?.primary ?? "#fbbf24",
    "--mpr-away-accent": awayTeam.kit?.primary ?? "#3b82f6",
  } as CSSProperties;

  return (
    <div
      className="mpr-row"
      data-match-id={matchId}
      role="group"
      aria-label={`${homeTeam.name} vs ${awayTeam.name} prediction`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={homeAccent}
    >
      <div className="mpr-team mpr-home">
        <TeamFlag
          code={homeTeam.id}
          name={homeTeam.name}
          accentColor={homeTeam.kit?.primary}
          size="sm"
          sparkle={prediction?.outcome === "home_win"}
        />
        <span className="mpr-team-code">{homeTeam.id}</span>
      </div>

      <div className="mpr-buttons" role="radiogroup" aria-label="Outcome">
        <button
          type="button"
          className={`mpr-btn mpr-btn-home ${prediction?.outcome === "home_win" ? "is-selected" : ""}`}
          aria-pressed={prediction?.outcome === "home_win"}
          aria-label={`${homeTeam.name} to win`}
          onClick={() => choose("home_win")}
          disabled={disabled}
        >
          Home Win
        </button>
        {!noDraw && (
          <button
            type="button"
            className={`mpr-btn mpr-btn-draw ${prediction?.outcome === "draw" ? "is-selected" : ""}`}
            aria-pressed={prediction?.outcome === "draw"}
            aria-label="Draw"
            onClick={() => choose("draw")}
            disabled={disabled}
          >
            Draw
          </button>
        )}
        <button
          type="button"
          className={`mpr-btn mpr-btn-away ${prediction?.outcome === "away_win" ? "is-selected" : ""}`}
          aria-pressed={prediction?.outcome === "away_win"}
          aria-label={`${awayTeam.name} to win`}
          onClick={() => choose("away_win")}
          disabled={disabled}
        >
          Away Win
        </button>
      </div>

      <div className="mpr-team mpr-away">
        <span className="mpr-team-code">{awayTeam.id}</span>
        <TeamFlag
          code={awayTeam.id}
          name={awayTeam.name}
          accentColor={awayTeam.kit?.primary}
          size="sm"
          sparkle={prediction?.outcome === "away_win"}
        />
      </div>

      <div className="mpr-scores-wrap">
        <button
          type="button"
          className="mpr-scores-toggle"
          aria-expanded={showScores}
          onClick={() => setShowScores((v) => !v)}
        >
          {showScores ? "Hide scores" : "Add score"}
        </button>
        {showScores && (
          <div className="mpr-scores">
            <label>
              <span className="sr-only">{homeTeam.name} score</span>
              <input
                type="number"
                min={0}
                max={99}
                value={prediction?.homeScore ?? ""}
                onChange={(e) => setScore("home", e.target.value)}
                disabled={disabled}
                aria-label={`${homeTeam.name} score`}
              />
            </label>
            <span aria-hidden="true">–</span>
            <label>
              <span className="sr-only">{awayTeam.name} score</span>
              <input
                type="number"
                min={0}
                max={99}
                value={prediction?.awayScore ?? ""}
                onChange={(e) => setScore("away", e.target.value)}
                disabled={disabled}
                aria-label={`${awayTeam.name} score`}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
