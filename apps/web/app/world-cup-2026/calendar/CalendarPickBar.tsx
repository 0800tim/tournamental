/**
 * CalendarPickBar, the inline 2- or 3-button picker rendered beneath
 * each calendar row.
 *
 * State machine per row:
 *
 *   - Past kickoff + result recorded → no pick bar; row shows score +
 *     tick/cross (handled by the parent row, not this component).
 *   - Past kickoff, no result yet → "Locked, awaiting result" pill.
 *   - Within kickoff..kickoff+4h → "In progress" pill, no buttons.
 *   - Pre-kickoff group match → [Home] [Draw] [Away] picker.
 *   - Pre-kickoff knockout match with both teams resolved → [Home] [Away] picker.
 *   - Pre-kickoff knockout where the cascade hasn't resolved both teams
 *     yet → disabled stub with "Pick groups to unlock" caption.
 *
 * Tim 2026-06-12: built so the calendar surface mirrors the bracket
 * page's interactivity. Picks save to the same single bracket via the
 * provider's autosave; last-write-wins per match by lockedAt.
 */

"use client";

import type { MouseEvent } from "react";

import {
  useCalendarPicks,
  type Outcome,
} from "./CalendarPicksContext";
import type { CalendarRow } from "./build-rows";

const STAGE_MAP: Record<
  CalendarRow["stage"],
  "group" | "r32" | "r16" | "qf" | "sf" | "tp" | "f"
> = {
  group: "group",
  r32: "r32",
  r16: "r16",
  qf: "qf",
  sf: "sf",
  tp: "tp",
  f: "f",
};

export interface CalendarPickBarProps {
  readonly row: CalendarRow;
  /** Resolved home code (may differ from row.home.code for knockouts after cascade). */
  readonly homeCode: string | undefined;
  /** Resolved away code (may differ from row.away.code for knockouts after cascade). */
  readonly awayCode: string | undefined;
  /** True if the kickoff is at or before now. */
  readonly isLocked: boolean;
  /** True if the match has a recorded result (caller renders score/verdict instead). */
  readonly hasResult: boolean;
}

export function CalendarPickBar(props: CalendarPickBarProps) {
  const { row, homeCode, awayCode, isLocked, hasResult } = props;
  const { bracket, setPick, hydrated } = useCalendarPicks();

  if (hasResult) return null;

  const isGroup = row.stage === "group";
  const stage = STAGE_MAP[row.stage];
  const pick = (
    isGroup
      ? bracket.matchPredictions?.[row.matchId]
      : bracket.knockoutPredictions?.[row.matchId]
  ) as { outcome?: Outcome } | undefined;
  const currentOutcome = pick?.outcome;

  if (isLocked) {
    // Locked, no result yet: show what they picked (if anything) +
    // an "awaiting result" caption.
    return (
      <div className="vt-cal-pickbar" data-state="locked">
        {currentOutcome ? (
          <span className="vt-cal-pickbar-locked-pick">
            Picked:{" "}
            <strong>{labelFor(currentOutcome, homeCode, awayCode)}</strong>
          </span>
        ) : (
          <span className="vt-cal-pickbar-locked-pick" data-empty="true">
            No pick made
          </span>
        )}
        <span className="vt-cal-pickbar-caption">Locked · awaiting result</span>
      </div>
    );
  }

  // Pre-kickoff. Knockout TBD case: both codes might be missing if
  // the cascade hasn't resolved the slot. Render disabled stubs.
  const teamsResolved = !!homeCode && !!awayCode;
  const buttonsDisabled = !hydrated || !teamsResolved;

  function onClick(outcome: Outcome) {
    return (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (buttonsDisabled) return;
      setPick({ matchId: row.matchId, outcome, stage });
    };
  }

  return (
    <div className="vt-cal-pickbar" data-state="open" data-stage={row.stage}>
      <button
        type="button"
        className="vt-cal-pick-btn"
        data-side="home"
        data-selected={currentOutcome === "home_win" ? "true" : "false"}
        disabled={buttonsDisabled}
        onClick={onClick("home_win")}
        aria-label={`Pick ${homeCode ?? "home"} to win match ${row.matchNo}`}
      >
        {homeCode ?? "TBD"}
      </button>
      {isGroup && (
        <button
          type="button"
          className="vt-cal-pick-btn"
          data-side="draw"
          data-selected={currentOutcome === "draw" ? "true" : "false"}
          disabled={buttonsDisabled}
          onClick={onClick("draw")}
          aria-label={`Pick draw for match ${row.matchNo}`}
        >
          DRAW
        </button>
      )}
      <button
        type="button"
        className="vt-cal-pick-btn"
        data-side="away"
        data-selected={currentOutcome === "away_win" ? "true" : "false"}
        disabled={buttonsDisabled}
        onClick={onClick("away_win")}
        aria-label={`Pick ${awayCode ?? "away"} to win match ${row.matchNo}`}
      >
        {awayCode ?? "TBD"}
      </button>
      {!teamsResolved && (
        <span className="vt-cal-pickbar-caption">
          Pick group winners to unlock
        </span>
      )}
    </div>
  );
}

function labelFor(
  outcome: Outcome,
  home: string | undefined,
  away: string | undefined,
): string {
  if (outcome === "home_win") return home ?? "home";
  if (outcome === "away_win") return away ?? "away";
  return "Draw";
}
