/**
 * POST /api/v1/syndicates/[slug]/join-requests/[userId]
 *
 * Owner-authenticated approve / deny endpoint used by the dashboard
 * manage view. Twin of the GET ...{approve|deny}?t=<token> email-link
 * routes — same effect, different auth model:
 *
 *   - email link path:  HMAC token issued by notify-join-request.ts
 *   - dashboard path:   tnm_session cookie + owner_user_id match
 *
 * Body: { action: "approve" | "deny" }
 *
 * 200 → { ok: true, status: "active" | "denied" }
 * 400 → bad request body
 * 401 → no session
 * 403 → session is not the pool owner
 * 404 → pool not found OR no pending request for that user_id
 *
 * Tim 2026-05-22.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";

import { getSessionFromRequest } from "@/lib/auth/session";
import { getPersistence } from "@/lib/syndicate/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  action: z.enum(["approve", "deny"]),
});

/**
 * SEC-WEB-09: the userId path param feeds straight into SQL lookups +
 * audit log entries; enforce the shape we actually use (`u_<hex>` or
 * `anon:<hex>`) before touching the DB.
 */
const USER_ID_RE = /^(u_[0-9a-f]{16,}|anon:[0-9a-f]{8,})$/i;

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string; userId: string } },
): Promise<Response> {
  const slug = (params.slug ?? "").toLowerCase().trim();
  // SEC-POOL-13: the URL param is now an opaque approval token issued
  // by listPendingMembers, NOT the raw user id. Reject obviously
  // malformed input (raw user id format is still accepted in dev when
  // APPROVAL_TOKEN_SECRET isn't set — see persistence.ts).
  const tokenOrId = (params.userId ?? "").trim();
  if (!slug || !tokenOrId) return json({ error: "bad_request" }, 400);
  // Loose-shape guard: token is base64url; raw user id matches the
  // legacy regex.
  if (
    !/^[A-Za-z0-9_-]{1,256}$/.test(tokenOrId) &&
    !USER_ID_RE.test(tokenOrId)
  ) {
    return json({ error: "bad_user_id" }, 400);
  }

  const session = await getSessionFromRequest(req);
  if (!session) return json({ error: "unauthorised" }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return json({ error: "bad_body" }, 400);

  const persistence = getPersistence();
  const pool = persistence.getBySlug(slug);
  if (!pool) return json({ error: "not_found" }, 404);
  if (pool.owner_user_id !== session.userId) {
    return json({ error: "forbidden" }, 403);
  }

  // SEC-POOL-13: resolve the opaque approval-token (or legacy raw
  // user id when APPROVAL_TOKEN_SECRET isn't set in dev) to the real
  // user id, scoped to this pool. Mismatched or expired tokens land
  // here as "not_found" so probing tokens doesn't yield more info
  // than probing user ids did before.
  const userId = persistence.resolveApprovalToken(pool.id, tokenOrId);
  if (!userId) {
    return json({ error: "not_found" }, 404);
  }

  const pending = persistence.getPendingMember(pool.id, userId);
  if (!pending) {
    // Idempotent: nothing to do, but report it cleanly so the
    // dashboard can clear the row from its local state.
    return json({ ok: true, status: "already-handled" }, 200);
  }

  const newStatus: "active" | "denied" =
    parsed.data.action === "approve" ? "active" : "denied";
  persistence.setMemberStatus({
    syndicate_id: pool.id,
    user_id: userId,
    status: newStatus,
  });

  if (newStatus === "active") {
    try {
      (
        persistence as unknown as {
          db: { prepare: (s: string) => { run: (...a: unknown[]) => void } };
        }
      ).db
        .prepare(`UPDATE syndicates SET member_count = member_count + 1 WHERE id = ?`)
        .run(pool.id);
    } catch {
      /* non-fatal */
    }
  }

  return json({ ok: true, status: newStatus }, 200);
}
