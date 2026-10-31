/**
 * Build the OFFICIAL results bracket for an archived tournament: a
 * Bracket whose "predictions" are the recorded results, so the
 * read-only bracket renderer shows what actually happened (group
 * tables, best thirds, every knockout) with no user input involved.
 */

import type { Bracket, MatchPrediction, Tournament } from "@tournamental/bracket-engine";

import { buildCompletedResults, type RecordedResultLite } from "@/lib/bracket/real-standings";
import { getPersistence } from "@/lib/syndicate/persistence";

export function buildOfficialResultsBracket(tournament: Tournament): Bracket {
  const rows = getPersistence().listRecordedMatchResultsForTournament(tournament.id) as ReadonlyArray<{
    match_id: string;
    outcome: "home_win" | "draw" | "away_win";
    homeScore?: number | null;
    awayScore?: number | null;
    homeTries?: number | null;
    awayTries?: number | null;
    winner?: string | null;
  }>;
  const byMatch = new Map<string, RecordedResultLite>();
  for (const r of rows) {
    byMatch.set(r.match_id, {
      outcome: r.outcome,
      homeScore: typeof r.homeScore === "number" ? r.homeScore : null,
      awayScore: typeof r.awayScore === "number" ? r.awayScore : null,
      homeTries: typeof r.homeTries === "number" ? r.homeTries : null,
      awayTries: typeof r.awayTries === "number" ? r.awayTries : null,
      winner: r.winner ?? null,
    });
  }

  // Tries ride along with the scores: the rendered pool table awards the
  // rugby bonus points from the prediction, and buildCompletedResults
  // ranks the best thirds from byMatch, so the two must see the same
  // tries or a table could disagree with the thirds it feeds.
  const matchPredictions: Record<string, MatchPrediction> = {};
  for (const f of tournament.group_fixtures) {
    const key = String(f.match_no);
    const r = byMatch.get(key);
    if (!r) continue;
    matchPredictions[key] = {
      matchId: key,
      outcome: r.outcome,
      ...(typeof r.homeScore === "number" ? { homeScore: r.homeScore } : {}),
      ...(typeof r.awayScore === "number" ? { awayScore: r.awayScore } : {}),
      ...(typeof r.homeTries === "number" ? { homeTries: r.homeTries } : {}),
      ...(typeof r.awayTries === "number" ? { awayTries: r.awayTries } : {}),
      lockedAt: "",
    };
  }

  const knockoutPredictions: Record<string, MatchPrediction> = {};
  for (const ko of tournament.knockouts) {
    const r = byMatch.get(ko.id);
    if (!r) continue;
    knockoutPredictions[ko.id] = {
      matchId: ko.id,
      outcome: r.outcome,
      ...(typeof r.homeScore === "number" ? { homeScore: r.homeScore } : {}),
      ...(typeof r.awayScore === "number" ? { awayScore: r.awayScore } : {}),
      ...(typeof r.homeTries === "number" ? { homeTries: r.homeTries } : {}),
      ...(typeof r.awayTries === "number" ? { awayTries: r.awayTries } : {}),
      lockedAt: "",
    };
  }

  const completed = buildCompletedResults(tournament, byMatch);

  return {
    bracketId: "official-results",
    matchPredictions,
    groupTiebreakers: {},
    bestThirds: completed.best_thirds,
    knockoutPredictions,
    version: 1,
  } as Bracket;
}
