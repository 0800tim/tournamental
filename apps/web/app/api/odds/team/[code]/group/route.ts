/**
 * /api/odds/team/[code]/group
 *
 * Group-winner probability for a single team. Requires the group id +
 * the full list of group team codes (so the mock can normalise across
 * the four teams). The bracket page passes these as query params.
 */

import { NextResponse, type NextRequest } from "next/server";

import { fetchTeamGroupSummary } from "@/lib/odds/client";

export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600",
};

export interface RouteContext {
  readonly params: Promise<{ readonly code: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { code } = (await ctx.params);
  if (!code) {
    return NextResponse.json({ error: "team code required" }, { status: 400 });
  }
  const url = new URL(req.url);
  const groupId = url.searchParams.get("group") ?? "";
  const groupTeamsRaw = url.searchParams.get("groupTeams") ?? "";
  const groupTeamCodes = groupTeamsRaw ? groupTeamsRaw.split(",").map((s) => s.trim()).filter(Boolean) : [code];

  const result = await fetchTeamGroupSummary({
    teamCode: code,
    groupId,
    groupTeamCodes,
    skipStub: true,
    // Server-only upstream so the browser uses this same-origin proxy
    // (no CORS) while the server reaches odds-ingest. Falls back to the
    // public NEXT_PUBLIC_ODDS_API_URL when ODDS_API_URL is unset.
    upstreamBaseUrl: process.env.ODDS_API_URL || undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json(result.data, { headers: CACHE_HEADERS });
}
