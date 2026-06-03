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
import { COUNTRIES } from "@/lib/syndicate/countries";

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
  // `eligible_for` accepts either an E.164 phone or a bare dial code
  // and filters the listing to pools the visitor can actually join
  // (no restriction OR phone-country matches the allow-list). Used
  // by the join-flow upsell when someone is bounced from a country-
  // gated pool. Cached separately per value via the URL.
  const eligibleFor = params.get("eligible_for")?.slice(0, 24) ?? null;

  // SEC-POOL-12: validate `eligible_for` against the known dial-code
  // list before forwarding to the persistence layer. The previous
  // shape silently accepted arbitrary strings, which fell through to
  // phoneMatchesAllowed and produced a confusing empty result rather
  // than a clear 400.
  if (eligibleFor) {
    const cleaned = eligibleFor.startsWith("+")
      ? eligibleFor.slice(1).replace(/\D/g, "")
      : eligibleFor.replace(/\D/g, "");
    if (!cleaned) {
      return Response.json({ error: "bad_eligible_for" }, { status: 400 });
    }
    const knownPrefixes = new Set(
      COUNTRIES.map((c) => c.dial.replace(/^\+/, "")),
    );
    const matched = [...knownPrefixes].some((p) => cleaned.startsWith(p));
    if (!matched) {
      return Response.json(
        { error: "unknown_country_code" },
        { status: 400 },
      );
    }
  }

  const rows = getPersistence().listPublic({ search, limit, offset, eligibleFor });
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
