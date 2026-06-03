/**
 * GET /api/v1/syndicates/[slug]/join-requests/[userId]/deny?t=<token>
 *
 * Single-use HMAC-tokenised deny link, twin of the approve route. The
 * token signs the action ("deny") so the same email can't accidentally
 * approve when the owner clicks the wrong button. Flips status to
 * 'denied' so a future re-join attempt by the same user_id sticks at
 * the denied state (the addMember ON CONFLICT clause intentionally
 * doesn't update status, so denied is sticky until the owner clears
 * the row manually).
 *
 * Tim 2026-05-22.
 */

import type { NextRequest } from "next/server";

import { getPersistence } from "@/lib/syndicate/persistence";
import { verifyApprovalToken } from "@/lib/syndicate/notify-join-request";
import { getSessionFromRequest } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectToManage(slug: string, status: string): Response {
  const base = process.env.NEXT_PUBLIC_PLAY_HOST ?? "https://play.tournamental.com";
  const url = `${base}/dashboard/syndicates/${encodeURIComponent(slug)}?request=${encodeURIComponent(status)}`;
  return Response.redirect(url, 302);
}

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ slug: string; userId: string }> }
): Promise<Response> {
  const params = await props.params;
  const slug = (params.slug ?? "").toLowerCase().trim();
  const userId = (params.userId ?? "").trim();
  const token = new URL(req.url).searchParams.get("t") ?? "";

  if (!slug || !userId) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const persistence = getPersistence();
  const pool = persistence.getBySlug(slug);
  if (!pool) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  if (!verifyApprovalToken(pool.id, userId, "deny", token)) {
    return Response.json({ error: "bad_token" }, { status: 403 });
  }

  // SEC-POOL-07: same defence-in-depth check as the approve route —
  // logged-in non-owner sessions can't trigger a deny, and null-owner-
  // user-id pools fall back to verified phone match (require dashboard
  // path otherwise).
  const session = await getSessionFromRequest(req);
  if (session) {
    if (pool.owner_user_id) {
      if (session.userId !== pool.owner_user_id) {
        return redirectToManage(slug, "forbidden");
      }
    } else if (pool.owner_phone) {
      if (session.phone && session.phone !== pool.owner_phone) {
        return redirectToManage(slug, "forbidden");
      }
    } else {
      return redirectToManage(slug, "needs-dashboard");
    }
  }

  const pending = persistence.getPendingMember(pool.id, userId);
  if (!pending) {
    return redirectToManage(slug, "already-handled");
  }

  persistence.setMemberStatus({
    syndicate_id: pool.id,
    user_id: userId,
    status: "denied",
  });

  return redirectToManage(slug, "denied");
}
