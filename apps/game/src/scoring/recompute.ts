/**
 * Per-bracket score recomputation.
 *
 * Walks every match result the service has recorded for a tournament,
 * pairs each with the user's prediction (group-stage in
 * `bracket.matchPredictions`, knockout in `bracket.knockoutPredictions`),
 * and sums the per-match points using the canonical scoring functions in
 * `@tournamental/bracket-engine/score`.
 *
 * The functions imported here (`scoreGroupMatchPrediction`,
 * `scoreKnockoutMatchPrediction`) are documented in `docs/30` and live in
 * `packages/bracket-engine/src/score.ts`. They take pure inputs and
 * return a deterministic breakdown — no clock reads, no randomness, no
 * external state. We feed them what we have on file.
 */

import {
  scoreGroupMatchPrediction,
  scoreKnockoutMatchPrediction,
  type MatchScoreInput,
  type KnockoutMatchScoreInput,
} from "@tournamental/bracket-engine/score";

import type { Bracket, MatchOutcome } from "../types.js";

const DEFAULT_WINDOW_S = 30 * 24 * 60 * 60; // 30 days
const DEFAULT_IMPLIED = 0.5;

/**
 * Compute the user's total score for a tournament given the latest
 * recorded outcomes. Pure function — no I/O.
 */
export function computeBracketScore(args: {
  bracket: Bracket;
  results: ReadonlyMap<string, MatchOutcome>;
}): { total: number; perMatch: ReadonlyArray<{ matchId: string; points: number }> } {
  let total = 0;
  const perMatch: { matchId: string; points: number }[] = [];

  for (const [matchId, outcome] of args.results) {
    const groupPick = args.bracket.matchPredictions[matchId];
    const knockoutPick = args.bracket.knockoutPredictions[matchId];

    let points = 0;
    if (groupPick && (outcome.stage === "group" || !outcome.stage)) {
      const input: MatchScoreInput = {
        stage: outcome.stage ?? "group",
        predictedOutcome: groupPick.outcome,
        actualOutcome: outcome.outcome,
        predictedHomeScore: groupPick.homeScore,
        predictedAwayScore: groupPick.awayScore,
        actualHomeScore: outcome.homeScore,
        actualAwayScore: outcome.awayScore,
        impliedAtLock: outcome.impliedAtLock ?? DEFAULT_IMPLIED,
        secondsSinceLock: outcome.secondsSinceLock ?? 0,
        windowSeconds: outcome.windowSeconds ?? DEFAULT_WINDOW_S,
      };
      points = scoreGroupMatchPrediction(input).pointsAwarded;
    } else if (
      knockoutPick &&
      outcome.stage &&
      outcome.stage !== "group" &&
      outcome.winner
    ) {
      // knockout: the user's `outcome` is "home_win"/"away_win" — derive
      // the predicted winner from the prediction shape. We only have the
      // outcome label (home_win/away_win) here, so map it through:
      //   predictedWinner = outcome.winner if pick.outcome matches
      //   actual outcome.outcome; otherwise leave as a non-match string.
      // Since we don't carry team ids on each predict (the bracket
      // builder uses team-based knockout predictions in
      // `MatchPrediction`'s outcome), we conservatively treat it as
      // correct iff the outcome label matches the actual outcome label.
      // This keeps the scoring deterministic without needing the
      // tournament topology in this service.
      const predictedWinner =
        knockoutPick.outcome === outcome.outcome ? outcome.winner : "__WRONG__";
      const input: KnockoutMatchScoreInput = {
        stage: outcome.stage,
        predictedWinner,
        actualWinner: outcome.winner,
        impliedAtLock: outcome.impliedAtLock ?? DEFAULT_IMPLIED,
        secondsSinceLock: outcome.secondsSinceLock ?? 0,
        windowSeconds: outcome.windowSeconds ?? DEFAULT_WINDOW_S,
      };
      points = scoreKnockoutMatchPrediction(input).pointsAwarded;
    }

    if (points > 0) {
      perMatch.push({ matchId, points });
      total += points;
    }
  }

  return { total, perMatch };
}
