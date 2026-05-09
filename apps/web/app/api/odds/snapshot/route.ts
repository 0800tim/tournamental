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
import type { MatchOdds, OddsSource } from "@/lib/odds/types";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600",
};

export const dynamic = "force-dynamic";

// The live odds-ingest service (apps/odds-ingest) returns one of two shapes:
//   1. { matches: [{matchNo, homeTeam, awayTeam, homeWin, draw, awayWin, source, updatedAt}, ...] }
//      — already what we want; passthrough.
//   2. { ts, market_count, probabilities: { "wc2026:match:N": { "<TeamName>": p, "Draw": p, "<TeamName>": p } } }
//      — needs team-name → 3-letter code translation, which we resolve via
//      the loaded tournament's team table.
function adaptIngestSnapshot(j: unknown, tournament: ReturnType<typeof loadFixtures2026>): MatchOdds[] | null {
  if (typeof j !== "object" || j === null) return null;
  const obj = j as Record<string, unknown>;
  if (Array.isArray(obj.matches)) return obj.matches as MatchOdds[];
  const probs = obj.probabilities as Record<string, Record<string, number>> | undefined;
  if (!probs) return null;

  const nameToCode = new Map(tournament.teams.map((t) => [t.name, t.id]));
  const groupByCodes = new Map(tournament.groups.map((g) => [g.id, g.team_ids]));
  const updatedAt = typeof obj.ts === "number" ? new Date(obj.ts).toISOString() : new Date().toISOString();
  const out: MatchOdds[] = [];
  for (const f of tournament.group_fixtures) {
    const codes = groupByCodes.get(f.group_id);
    if (!codes) continue;
    const home = codes[f.home_idx];
    const away = codes[f.away_idx];
    if (!home || !away) continue;
    const row = probs[`wc2026:match:${f.match_no}`];
    if (!row) continue;
    const homeName = tournament.teams.find((t) => t.id === home)?.name;
    const awayName = tournament.teams.find((t) => t.id === away)?.name;
    if (!homeName || !awayName) continue;
    void nameToCode;
    const homeWin = row[homeName];
    const awayWin = row[awayName];
    const draw = row["Draw"];
    if (typeof homeWin !== "number" || typeof awayWin !== "number") continue;
    out.push({
      matchNo: String(f.match_no),
      homeTeam: home,
      awayTeam: away,
      homeWin,
      draw: typeof draw === "number" ? draw : null,
      awayWin,
      source: "polymarket" as OddsSource,
      updatedAt,
    });
  }
  return out.length > 0 ? out : null;
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const tournament = loadFixtures2026();
  const upstream = process.env.ODDS_API_URL ?? process.env.NEXT_PUBLIC_ODDS_API_URL;
  if (upstream) {
    try {
      const r = await fetch(`${upstream.replace(/\/$/, "")}/v1/odds/snapshot`, {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 },
      });
      if (r.ok) {
        const j = await r.json();
        const adapted = adaptIngestSnapshot(j, tournament);
        if (adapted) {
          return NextResponse.json(
            { matches: adapted, source: "polymarket", updatedAt: new Date().toISOString() },
            { headers: CACHE_HEADERS },
          );
        }
      }
    } catch {
      // Fall through to mock.
    }
  }

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
