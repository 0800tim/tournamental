/**
 * CalendarResultBar, the resulted-state pill rendered beneath each
 * calendar row when a match has a recorded result.
 *
 * Mirrors the bracket page's resulted-row treatment:
 *
 *   - Score chip ("2 - 0" or "2 - 1" or "1 - 1") in the centre.
 *   - User's pick called out on the side with a tick or cross
 *     depending on whether their outcome matched the recorded one.
 *   - When the user has no pick, just shows the score with a neutral
 *     "no pick" caption.
 *
 * Tim 2026-06-12: built so the calendar's read-only-for-past-matches
 * surface gives the same feedback as the bracket page.
 */

"use client";

import { useCalendarPicks, type Outcome } from "./CalendarPicksContext";
import type { CalendarRow } from "./build-rows";
import type { ResultedMatch } from "./types";

export interface CalendarResultBarProps {
  readonly row: CalendarRow;
  readonly result: ResultedMatch;
  readonly homeCode: string | undefined;
  readonly awayCode: string | undefined;
}

export function CalendarResultBar(props: CalendarResultBarProps) {
  const { row, result, homeCode, awayCode } = props;
  const { bracket } = useCalendarPicks();

  const isGroup = row.stage === "group";
  const pick = (
    isGroup
      ? bracket.matchPredictions?.[row.matchId]
      : bracket.knockoutPredictions?.[row.matchId]
  ) as { outcome?: Outcome } | undefined;
  const picked = pick?.outcome ?? null;
  const correct = picked ? picked === result.outcome : null;

  const home = result.homeScore ?? "?";
  const away = result.awayScore ?? "?";

  return (
    <div
      className="vt-cal-resultbar"
      data-correct={correct === true ? "true" : correct === false ? "false" : "none"}
    >
      <span className="vt-cal-resultbar-score" aria-label="Final score">
        <span className="vt-cal-resultbar-home">{home}</span>
        <span className="vt-cal-resultbar-dash">·</span>
        <span className="vt-cal-resultbar-away">{away}</span>
      </span>
      <span className="vt-cal-resultbar-pick">
        {picked === null ? (
          <span className="vt-cal-resultbar-nopick">No pick</span>
        ) : (
          <>
            <span className="vt-cal-resultbar-yourpick">
              You picked: {labelFor(picked, homeCode, awayCode)}
            </span>
            {correct === true ? (
              <span
                className="vt-cal-resultbar-verdict"
                data-verdict="correct"
                aria-label="Correct"
                title="Correct"
              >
                ✓
              </span>
            ) : (
              <span
                className="vt-cal-resultbar-verdict"
                data-verdict="wrong"
                aria-label="Incorrect"
                title="Incorrect"
              >
                ✕
              </span>
            )}
          </>
        )}
      </span>
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
