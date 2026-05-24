/**
 * GET /api/v1/syndicates/public — the public pool directory feed.
 *
 * Lists public syndicates (is_public = 1), newest first, with an optional
 * `search` substring match across name / slug / topic. Returns only
 * public-safe fields (see lib/syndicate/public-directory.ts).
 *
 * Query params: `search` (string), `limit` (1..100, default 60),
 * `offset` (>=0, default 0).
 *
 * Cache: short edge TTL + SWR — a directory is public marketing content,
 * not personalised, and tolerates a few minutes of staleness.
 */

import type { NextRequest } from "next/server";

import { getPersistence } from "@/lib/syndicate/persistence";
import { toPublicPoolDto } from "@/lib/syndicate/public-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function intParam(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: NextRequest): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const search = params.get("search")?.slice(0, 100) ?? undefined;
  const limit = intParam(params.get("limit"), 60);
  const offset = intParam(params.get("offset"), 0);

  const rows = getPersistence().listPublic({ search, limit, offset });
  const pools = rows.map(toPublicPoolDto);

  return Response.json(
    { pools, count: pools.length },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
