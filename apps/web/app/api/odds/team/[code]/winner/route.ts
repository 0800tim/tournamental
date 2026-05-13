/**
 * /api/odds/team/[code]/winner
 *
 * Tournament-winner probability for a single team. Proxies upstream if
 * configured, otherwise mocks from the world rank.
 */

import { NextResponse, type NextRequest } from "next/server";

import { fetchTeamWinnerSummary } from "@/lib/odds/client";

export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600",
};

export interface RouteContext {
  readonly params: { readonly code: string };
}

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { code } = ctx.params;
  if (!code) return NextResponse.json({ error: "team code required" }, { status: 400 });
  // skipStub: prevent the route from calling itself.
  const result = await fetchTeamWinnerSummary({ teamCode: code, skipStub: true });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json(result.data, { headers: CACHE_HEADERS });
}
