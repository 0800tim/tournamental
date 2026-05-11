/**
 * Predict tab, embeds the existing `MatchPredictionRow` so the user
 * can pick from the preview screen, mirroring the bracket UX. When the
 * user already has a pick, surface the saved-odds chip beneath the row.
 *
 * Both teams must be resolved (i.e. the cascade has filled the slot
 * for knockout matches) before we render the row. When an opponent is
 * "TBD", show a friendly explanatory state rather than a broken row.
 */

"use client";

import type { MatchPrediction, Team } from "@tournamental/bracket-engine";

import { MatchPredictionRow } from "@/components/bracket/MatchPredictionRow";

import type { ResolvedMatch } from "../_lib/match-data";

export interface PredictTabProps {
  readonly match: ResolvedMatch;
  readonly homeTeam: Team | null;
  readonly awayTeam: Team | null;
  readonly prediction?: MatchPrediction;
  readonly onChange: (next: MatchPrediction) => void;
}

function pctLabel(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "-";
  return `${Math.round(p * 100)}%`;
}

export function PredictTab(props: PredictTabProps) {
  const { match, homeTeam, awayTeam, prediction, onChange } = props;

  if (!homeTeam || !awayTeam) {
    return (
      <div className="mp-tab-content mp-predict-tbd">
        <p className="mp-empty-headline">
          One or both teams are still to be determined.
        </p>
        <p className="mp-empty-hint">
          Predict {match.homeSlotLabel ?? "the upstream knockout"}
          {" "}and{" "}
          {match.awaySlotLabel ?? "the upstream knockout"} on the{" "}
          <a href="/world-cup-2026">bracket page</a> to enable this pick.
        </p>
      </div>
    );
  }

  const noDraw = match.stage !== "group";
  const lock = prediction?.oddsAtLock;

  return (
    <div className="mp-tab-content mp-predict">
      <MatchPredictionRow
        matchId={match.matchId}
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        prediction={prediction}
        noDraw={noDraw}
        groupLabel={match.stageLabel}
        kickoffIso={match.kickoffUtc}
        onChange={onChange}
      />

      {lock && (
        <div className="mp-locked-odds" data-testid="mp-locked-odds">
          <span className="mp-locked-odds-title">Saved odds</span>
          <span className="mp-locked-odds-row">
            <span>
              {homeTeam.id} {pctLabel(lock.homeWin)}
            </span>
            {!noDraw && lock.draw != null && (
              <span>Draw {pctLabel(lock.draw)}</span>
            )}
            <span>
              {awayTeam.id} {pctLabel(lock.awayWin)}
            </span>
          </span>
          <span className="mp-locked-odds-meta">
            Source: {lock.source}, saved{" "}
            {new Date(lock.capturedAt).toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
}
