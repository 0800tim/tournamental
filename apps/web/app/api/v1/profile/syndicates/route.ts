/**
 * GET /api/v1/profile/syndicates
 *
 * Returns the syndicates associated with the authenticated user:
 *   - Owned: rows where owner_user_id matches
 *   - Member: rows joined via syndicate_owners_membership
 *
 * Response: { syndicates: SyndicateListItem[] }
 */

import type { NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { getPersistence } from "@/lib/syndicate/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface SyndicateListItem {
  slug: string;
  name: string;
  share_guid: string;
  role: "owner" | "member";
  member_count: number;
  tournament_id: string;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

type SyndicateBasicRow = {
  slug: string;
  name: string;
  share_guid: string;
  member_count: number;
  tournament_id: string;
};

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getSessionFromRequest(req);
  if (!session) return json({ error: "no_session" }, 401);

  const userId = session.userId;

  try {
    const { db } = getPersistence();

    // Syndicates the user owns (owner_user_id column).
    const ownedRows = db
      .prepare(
        `SELECT slug, name, share_guid, member_count, tournament_id
         FROM syndicates WHERE owner_user_id = ?`,
      )
      .all(userId) as SyndicateBasicRow[];

    // All syndicate_ids the user belongs to via membership table.
    const membershipRows = db
      .prepare(
        `SELECT s.slug, s.name, s.share_guid, s.member_count, s.tournament_id
         FROM syndicate_owners_membership m
         JOIN syndicates s ON s.id = m.syndicate_id
         WHERE m.user_id = ?`,
      )
      .all(userId) as SyndicateBasicRow[];

    // Merge: owned wins over member when the same slug appears in both.
    const seen = new Set<string>();
    const syndicates: SyndicateListItem[] = [];

    for (const r of ownedRows) {
      seen.add(r.slug);
      syndicates.push({ ...r, role: "owner" });
    }
    for (const r of membershipRows) {
      if (!seen.has(r.slug)) {
        seen.add(r.slug);
        syndicates.push({ ...r, role: "member" });
      }
    }

    return json({ syndicates });
  } catch {
    return json({ syndicates: [] });
  }
}
