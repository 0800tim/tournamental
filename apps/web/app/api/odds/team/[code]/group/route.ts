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
  readonly params: { readonly code: string };
}

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { code } = ctx.params;
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
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json(result.data, { headers: CACHE_HEADERS });
}
