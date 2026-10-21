/**
 * The official-results path sizes and ranks the best thirds by the
 * tournament's rules: four of six for Rugby World Cup 2027, ordered by
 * World Rugby's cross-group chain. The 2026 behaviour (eight of twelve by
 * FIFA's chain) is covered by __tests__/archive/results-bracket.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  computeGroupStandings,
  loadFixturesRwc2027,
  type MatchPrediction,
  type Tournament,
} from "@tournamental/bracket-engine";

import { buildCompletedResults, type RecordedResultLite } from "@/lib/bracket/real-standings";
import { teamWorldRank } from "@/lib/bracket/thirds";

const rwc: Tournament = loadFixturesRwc2027();

/**
 * Every pool: the lower-indexed team wins. The winning margin and the
 * winner's tries vary by pool so the six thirds (index 2 in each pool)
 * end up with different records: a close loss (margin 7 or less) earns
 * the third a losing bonus point, and beating the fourth team with four
 * tries earns a try bonus.
 */
const MARGIN = [20, 15, 5, 12, 3, 25] as const;
const WINNER_TRIES = [3, 2, 2, 2, 2, 4] as const;

function recordAll(skipMatchNo?: number): Map<string, RecordedResultLite> {
  const results = new Map<string, RecordedResultLite>();
  rwc.groups.forEach((g, gi) => {
    for (const f of rwc.group_fixtures.filter((x) => x.group_id === g.id)) {
      if (f.match_no === skipMatchNo) continue;
      const homeWins = f.home_idx < f.away_idx;
      const margin = MARGIN[gi]!;
      const winnerScore = 10 + margin;
      const loserScore = 10;
      results.set(String(f.match_no), {
        outcome: homeWins ? "home_win" : "away_win",
        homeScore: homeWins ? winnerScore : loserScore,
        awayScore: homeWins ? loserScore : winnerScore,
        winner: g.team_ids[homeWins ? f.home_idx : f.away_idx]!,
      });
    }
  });
  return results;
}

function thirdsByRule(results: ReadonlyMap<string, RecordedResultLite>): string[] {
  const rows = rwc.groups.map((g) => {
    const preds: Record<string, MatchPrediction> = {};
    for (const f of rwc.group_fixtures.filter((x) => x.group_id === g.id)) {
      const r = results.get(String(f.match_no))!;
      preds[String(f.match_no)] = {
        matchId: String(f.match_no),
        outcome: r.outcome,
        homeScore: r.homeScore ?? undefined,
        awayScore: r.awayScore ?? undefined,
        lockedAt: "",
      };
    }
    return computeGroupStandings(g.id, rwc, preds)[2]!;
  });
  const rank = (id: string) => teamWorldRank(rwc.teams.find((t) => t.id === id));
  return rows
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.goalDiff - a.goalDiff ||
        b.goalsFor - a.goalsFor ||
        b.triesFor - a.triesFor ||
        rank(a.teamCode) - rank(b.teamCode) ||
        a.teamCode.localeCompare(b.teamCode),
    )
    .map((s) => s.teamCode);
}

describe("buildCompletedResults for Rugby World Cup 2027", () => {
  it("settles all six pools from 36 recorded results", () => {
    const out = buildCompletedResults(rwc, recordAll());
    expect(out.groups).toHaveLength(6);
    expect(out.groups.every((g) => g.settled)).toBe(true);
    for (const g of out.groups) expect(g.final_order).toHaveLength(4);
  });

  it("leaves best thirds undefined while any pool is unsettled", () => {
    const out = buildCompletedResults(rwc, recordAll(36));
    expect(out.groups.filter((g) => g.settled)).toHaveLength(5);
    expect(out.best_thirds).toBeUndefined();
  });

  it("takes four thirds, ordered by the World Rugby cross-group chain", () => {
    const results = recordAll();
    const out = buildCompletedResults(rwc, results);
    const thirds = rwc.groups.map((g) => g.team_ids[2]!);
    expect(out.best_thirds).toHaveLength(4);
    expect(out.best_thirds!.every((t) => thirds.includes(t))).toBe(true);
    expect(out.best_thirds).toEqual(thirdsByRule(results).slice(0, 4));
    // Pools C and E lost their matches by 5 and 3 points, so their thirds
    // carry losing bonus points and must be in the four.
    expect(out.best_thirds).toContain("ESP");
    expect(out.best_thirds).toContain("USA");
  });
});
