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
 * Every pool: the lower-indexed team wins. The winning margin varies by
 * pool so the six thirds (index 2 in each pool) end up with different
 * records: a close loss (margin 7 or less) earns the third a losing bonus
 * point. With `withTries`, the thirds of pools A and B beat their fourth
 * team with four tries, which earns a try bonus; every other winner
 * scores two tries and every loser one.
 */
const MARGIN = [20, 15, 5, 12, 3, 25] as const;
const TRY_BONUS_POOLS = new Set(["A", "B"]);

function recordAll(opts: { skipMatchNo?: number; withTries?: boolean } = {}): Map<string, RecordedResultLite> {
  const results = new Map<string, RecordedResultLite>();
  rwc.groups.forEach((g, gi) => {
    for (const f of rwc.group_fixtures.filter((x) => x.group_id === g.id)) {
      if (f.match_no === opts.skipMatchNo) continue;
      const homeWins = f.home_idx < f.away_idx;
      const margin = MARGIN[gi]!;
      const winnerScore = 10 + margin;
      const loserScore = 10;
      const thirdBeatsFourth = Math.min(f.home_idx, f.away_idx) === 2;
      const winnerTries = thirdBeatsFourth && TRY_BONUS_POOLS.has(g.id) ? 4 : 2;
      const loserTries = 1;
      results.set(String(f.match_no), {
        outcome: homeWins ? "home_win" : "away_win",
        homeScore: homeWins ? winnerScore : loserScore,
        awayScore: homeWins ? loserScore : winnerScore,
        ...(opts.withTries
          ? {
              homeTries: homeWins ? winnerTries : loserTries,
              awayTries: homeWins ? loserTries : winnerTries,
            }
          : {}),
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
        homeTries: r.homeTries ?? undefined,
        awayTries: r.awayTries ?? undefined,
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
    const out = buildCompletedResults(rwc, recordAll({ skipMatchNo: 36 }));
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
    // Without tries recorded nobody earns a try bonus, so the four are
    // the two losing-bonus thirds (USA ahead of ESP on points difference,
    // -3 against -5) and then the two with the best points difference:
    // URU (pool D, lost by 12) and GEO (pool B, lost by 15).
    expect(out.best_thirds).toEqual(["USA", "ESP", "URU", "GEO"]);
  });

  it("carries tries through so a try bonus can change the four", () => {
    const results = recordAll({ withTries: true });
    const out = buildCompletedResults(rwc, results);
    expect(out.best_thirds).toEqual(thirdsByRule(results).slice(0, 4));
    // CHI (pool A) and GEO (pool B) scored four tries against their
    // fourth team: 5 points each, above URU's 4, so CHI replaces URU.
    expect(out.best_thirds).toEqual(["USA", "ESP", "GEO", "CHI"]);
  });
});
