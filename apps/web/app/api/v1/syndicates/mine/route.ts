/**
 * GET /api/v1/syndicates/mine
 *
 * Returns the list of syndicates owned by the currently-authenticated
 * user. Powers the affiliate dashboard at `/dashboard/syndicates`.
 *
 * Auth: requires a valid `tnm_session` cookie. 401 if absent or
 * invalid. Never reveals whether a given user has zero syndicates vs
 * is unauthenticated, those are different status codes for the
 * dashboard to render different UI.
 *
 * Cache policy: `private, no-store`. Per-user content, never cached.
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

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return jsonResponse({ error: "unauthorised" }, 401);
  }

  const persistence = getPersistence();
  const rows = persistence.listByOwnerUserId(session.userId);

  // Trim the rows to the fields the dashboard actually needs. Owner
  // contact details, the GHL retry-queue, etc. don't belong in this
  // response shape, which is consumed by the owner's own browser.
  const syndicates = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    tournament_id: r.tournament_id,
    tier: r.tier,
    member_count: r.member_count,
    created_at: r.created_at,
    share_guid: r.share_guid,
    hl_location_id: r.hl_location_id,
    hl_premium_since: r.hl_premium_since,
    topic: r.topic,
  }));

  return jsonResponse(
    {
      ok: true,
      count: syndicates.length,
      syndicates,
    },
    200,
  );
}
