/**
 * /api/odds/match/[matchNo]
 *
 * Tier-2 stub. Proxies to the upstream `apps/odds-ingest` REST surface
 * if `ODDS_API_URL` is configured; otherwise returns a deterministic
 * mock derived from the world-rank lookup in `data/fifa-wc-2026/teams.json`.
 *
 * Cache policy: `s-maxage=30, stale-while-revalidate=300` per the
 * standing rule in CLAUDE.md and the table in
 * `docs/29-polymarket-odds-integration.md` (`/v1/odds/markets/:slug`).
 */

import { NextResponse, type NextRequest } from "next/server";

import { generateMockOdds } from "@/lib/odds/client";

export const dynamic = "force-dynamic";
export const revalidate = 30;

export interface RouteContext {
  readonly params: { readonly matchNo: string };
}

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300",
};

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { matchNo } = ctx.params;
  if (!matchNo) {
    return NextResponse.json({ error: "matchNo required" }, { status: 400 });
  }
  const url = new URL(req.url);
  const homeTeam = url.searchParams.get("home") ?? "";
  const awayTeam = url.searchParams.get("away") ?? "";
  const noDraw = url.searchParams.get("noDraw") === "1";

  const upstream = process.env.ODDS_API_URL ?? process.env.NEXT_PUBLIC_ODDS_API_URL;
  if (upstream) {
    try {
      const upstreamUrl = `${upstream.replace(/\/$/, "")}/v1/odds/match/${encodeURIComponent(matchNo)}`;
      const r = await fetch(upstreamUrl, {
        headers: { Accept: "application/json" },
        // Next caching: short TTL so we follow the upstream.
        next: { revalidate: 30 },
      });
      if (r.ok) {
        const j = await r.json();
        return NextResponse.json(j, { headers: CACHE_HEADERS });
      }
    } catch {
      // Fall through to mock.
    }
  }

  const data = generateMockOdds(matchNo, homeTeam, awayTeam, noDraw);
  return NextResponse.json(data, { headers: CACHE_HEADERS });
}
