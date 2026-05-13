/**
 * GET /api/v1/syndicates/[slug]/owner
 *
 * Owner-scoped view of a single syndicate. Returns the full row only
 * if the signed-in user is the owner; 401 unauth, 403 not-owner, 404
 * unknown slug.
 *
 * Powers the per-syndicate manage screen at
 * `/dashboard/syndicates/[slug]`. The public landing at `/s/[guid]`
 * uses a different endpoint with no auth and a smaller projection.
 *
 * Cache: private, no-store. Per-user, mutable.
 */

import type { NextRequest } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { getPersistence } from "@/lib/syndicate/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } },
): Promise<Response> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return jsonResponse({ error: "unauthorised" }, 401);
  }

  const slug = (params.slug ?? "").toLowerCase().trim();
  if (!slug) {
    return jsonResponse({ error: "bad_slug" }, 400);
  }

  const persistence = getPersistence();
  const row = persistence.getBySlug(slug);
  if (!row) {
    return jsonResponse({ error: "not_found" }, 404);
  }

  if (row.owner_user_id !== session.userId) {
    // Don't leak existence vs ownership separately; treat both the
    // same. The owner sees their data; everyone else sees the public
    // /s/[guid] landing if they want the public projection.
    return jsonResponse({ error: "forbidden" }, 403);
  }

  return jsonResponse(
    {
      ok: true,
      syndicate: {
        id: row.id,
        slug: row.slug,
        name: row.name,
        tournament_id: row.tournament_id,
        tier: row.tier,
        member_count: row.member_count,
        created_at: row.created_at,
        share_guid: row.share_guid,
        hl_location_id: row.hl_location_id,
        hl_premium_since: row.hl_premium_since,
        topic: row.topic,
        size_band: row.size_band,
        marketing_consent: row.marketing_consent === 1,
        owner_handle: row.owner_handle,
      },
    },
    200,
  );
}
