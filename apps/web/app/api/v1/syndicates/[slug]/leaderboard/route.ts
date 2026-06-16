/*
 * Copyright 2026 Tournamental
 * Apache 2.0 (see LICENSE).
 */

/**
 * GET /api/v1/syndicates/[slug]/leaderboard
 *
 * Returns the current ranked members for a syndicate pool, JSON. Powers
 * the client-side 30s poll on /s/<slug> so viewers see standings update
 * within a minute of a match resulting, without pull-to-refresh.
 *
 * Response shape:
 *
 *   {
 *     slug: string,
 *     fetched_at: number,          // server epoch ms when this was assembled
 *     matches_available: number,    // Y for the "X / Y" denominator
 *     members: Array<{
 *       handle: string,             // slugified handle the row keys on
 *       display_name: string | null,
 *       points: number,             // = correct_picks for resulted matches
 *       flag_emoji: string,         // country flag for the row glyph
 *       joined_at: string,          // ISO-8601, used as tie-breaker
 *     }>,
 *   }
 *
 * Cache policy (Tim 2026-06-16):
 *   - 10s edge cache + 30s stale-while-revalidate. Concurrent viewers
 *     share one upstream call within 10s. New data lands on the client
 *     within 10..30s of a result POST + cache.invalidateTournament.
 *   - The page itself (/s/<slug>) still SSRs at the longer s-maxage=60
 *     so first paint stays instant from the CDN; the client poll keeps
 *     the visible numbers fresh after that.
 *
 * Returns 404 when the slug doesn't resolve (so the client can stop
 * polling).
 */

import { NextResponse } from "next/server";

import { enrichSyndicateMembers } from "@/lib/syndicate/enrich-members";
import { getPersistence } from "@/lib/syndicate/persistence";
import { loadSyndicateBySlug } from "@/lib/syndicate/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { slug?: string } },
): Promise<Response> {
  const slug = (params.slug ?? "").trim();
  if (!slug) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }

  const syndicate = await loadSyndicateBySlug(slug);
  if (!syndicate) {
    return NextResponse.json(
      { error: "syndicate_not_found" },
      { status: 404 },
    );
  }

  const enriched = enrichSyndicateMembers({
    members: syndicate.members,
    tournamentId: syndicate.tournament_id,
  });

  // Match the page's sort order: points desc, then join order ascending.
  // The client recomputes rank + tied display from this so we don't
  // duplicate the tier logic across surfaces.
  const sorted = [...enriched].sort(
    (a, b) =>
      b.points - a.points || a.joined_at.localeCompare(b.joined_at),
  );

  const matchesAvailable = getPersistence()
    .countRecordedMatchesForTournament(syndicate.tournament_id);

  const members = sorted.map((m) => ({
    user_id: m.user_id ?? null,
    handle: m.handle,
    display_name: m.display_name ?? null,
    points: m.points,
    flag_emoji: m.flag_emoji,
    avatar_url: m.avatar_url ?? null,
    joined_at: m.joined_at,
  }));

  const res = NextResponse.json({
    slug,
    fetched_at: Date.now(),
    matches_available: matchesAvailable,
    members,
  });
  res.headers.set(
    "Cache-Control",
    "public, max-age=10, s-maxage=10, stale-while-revalidate=30",
  );
  return res;
}
