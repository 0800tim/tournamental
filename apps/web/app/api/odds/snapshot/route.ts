/**
 * /api/odds/snapshot
 *
 * Bulk endpoint: returns the latest odds for every group fixture in
 * one response. Used by the bracket page to bootstrap the chips
 * without firing 72 individual requests on first paint.
 *
 * Cache: long edge cache + SWR. Mock fallthrough is deterministic.
 */

import { NextResponse, type NextRequest } from "next/server";

import { loadFixtures2026 } from "@vtorn/bracket-engine";

import { generateMockOdds } from "@/lib/odds/client";
import type { MatchOdds } from "@/lib/odds/types";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600",
};

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const upstream = process.env.ODDS_API_URL ?? process.env.NEXT_PUBLIC_ODDS_API_URL;
  if (upstream) {
    try {
      const r = await fetch(`${upstream.replace(/\/$/, "")}/v1/odds/snapshot`, {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 },
      });
      if (r.ok) {
        const j = await r.json();
        return NextResponse.json(j, { headers: CACHE_HEADERS });
      }
    } catch {
      // Fall through to mock.
    }
  }

  const tournament = loadFixtures2026();
  const groupByCodes = new Map(
    tournament.groups.map((g) => [g.id, g.team_ids]),
  );
  const matches: MatchOdds[] = [];
  for (const f of tournament.group_fixtures) {
    const codes = groupByCodes.get(f.group_id);
    if (!codes) continue;
    const home = codes[f.home_idx];
    const away = codes[f.away_idx];
    if (!home || !away) continue;
    matches.push(generateMockOdds(String(f.match_no), home, away, false));
  }
  return NextResponse.json(
    { matches, source: "mock-fifa-rank", updatedAt: new Date().toISOString() },
    { headers: CACHE_HEADERS },
  );
}
