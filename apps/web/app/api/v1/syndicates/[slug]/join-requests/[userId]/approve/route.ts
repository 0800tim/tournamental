/**
 * GET /api/v1/syndicates/[slug]/join-requests/[userId]/approve?t=<token>
 *
 * Single-use HMAC-tokenised approve link emailed to the pool owner
 * when a new user requests to join an approval-gated pool. Verifies
 * the token, flips the membership row's status from 'pending' to
 * 'active', and redirects the owner to the pool's manage dashboard
 * with a status banner.
 *
 * The token is signed by `signApprovalToken` in
 * `lib/syndicate/notify-join-request.ts` so a separate "deny" link
 * carries its own token — the same URL can't be used for both actions.
 *
 * Idempotent by design: re-approving an already-active row is a no-op
 * and still redirects with a friendly "already handled" banner.
 *
 * Auth model: the link itself is the auth (the owner received it via
 * their verified email). We don't require a tnm_session cookie so a
 * pool owner can approve from any device.
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
  { params }: { params: { slug: string; userId: string } },
): Promise<Response> {
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

  if (!verifyApprovalToken(pool.id, userId, "approve", token)) {
    return Response.json({ error: "bad_token" }, { status: 403 });
  }

  // SEC-POOL-07: defence in depth. If the visitor IS logged in, refuse
  // to act when their session isn't the pool owner. For null-owner-
  // user-id legacy pools, fall back to a verified phone match against
  // owner_phone — if even that's missing, refuse and require the
  // dashboard path. Incident 2026-06-03 was the trigger here: a
  // denormalised owner_email pointed at the requester so SendGrid
  // delivered the approve link to them; they clicked and the row
  // flipped without any owner involvement.
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
      // No owner_user_id AND no owner_phone — can't verify ownership
      // server-side. Require the dashboard path.
      return redirectToManage(slug, "needs-dashboard");
    }
  }

  // Look up the pending row so we can confirm + display useful info.
  const pending = persistence.getPendingMember(pool.id, userId);
  if (!pending) {
    // Either the user_id doesn't match any pending row (already
    // handled, never existed, or denied previously). Idempotent
    // redirect with a friendly banner.
    return redirectToManage(slug, "already-handled");
  }

  const changed = persistence.setMemberStatus({
    syndicate_id: pool.id,
    user_id: userId,
    status: "active",
  });

  if (changed > 0) {
    // Bump cached member_count so the public landing reflects the
    // new active member without waiting for game-service backfill.
    try {
      (persistence as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } })
        .db
        .prepare(`UPDATE syndicates SET member_count = member_count + 1 WHERE id = ?`)
        .run(pool.id);
    } catch {
      /* non-fatal */
    }
  }

  return redirectToManage(slug, "approved");
}
