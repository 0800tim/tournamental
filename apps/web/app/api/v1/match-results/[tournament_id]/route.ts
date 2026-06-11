/**
 * GET /api/v1/match-results/[tournament_id]
 *
 * Returns every recorded match result for a tournament:
 *
 *   {
 *     tournament_id: string,
 *     results: Array<{
 *       match_id: string,
 *       outcome: "home_win" | "draw" | "away_win",
 *       homeScore: number | null,
 *       awayScore: number | null,
 *       winner_code: string | null,
 *       recorded_at: number,
 *     }>,
 *   }
 *
 * Backs the bracket UI's resulted-state rendering, the leaderboard
 * Y denominator, and any other consumer that needs to know which
 * fixtures have been played. Reads directly from the game DB via
 * SyndicatePersistence (same path the syndicate page leaderboard
 * uses) so we avoid an HTTP hop to the game service. A small edge
 * cache absorbs the page-mount thundering-herd; clients still call
 * this on every page load to pick up newly-resulted matches.
 *
 * Tim 2026-06-12.
 */

import { NextResponse } from "next/server";

import { getPersistence } from "@/lib/syndicate/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { tournament_id?: string } },
): Promise<Response> {
  const tournamentId = (params.tournament_id ?? "").trim();
  if (!tournamentId) {
    return NextResponse.json(
      { error: "invalid_tournament_id" },
      { status: 400 },
    );
  }
  const results = getPersistence()
    .listRecordedMatchResultsForTournament(tournamentId);
  const res = NextResponse.json({
    tournament_id: tournamentId,
    results,
  });
  // Short edge cache + SWR: results don't change second-by-second, but
  // when a match settles we want the new row to reach viewers fast.
  res.headers.set(
    "Cache-Control",
    "public, max-age=15, s-maxage=15, stale-while-revalidate=60",
  );
  return res;
}
