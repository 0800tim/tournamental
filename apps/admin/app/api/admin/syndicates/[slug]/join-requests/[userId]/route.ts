/**
 * POST /api/admin/syndicates/[slug]/join-requests/[userId]
 * Body: { action: "approve" | "deny" }
 *
 * Admin-side approval queue action for the approval-gated pool join
 * flow. Mirrors the owner-side `/api/v1/syndicates/.../approve` link
 * the owner receives by email, but gated by the admin session/perms
 * instead of an HMAC-signed token. Used when an owner is slow to
 * respond or when Tournamental staff need to unblock a member directly.
 *
 * Writes go through `applyJoinRequestAction` in `lib/live.ts` which
 * opens a writable game.db handle and runs the UPDATE + member_count
 * bump in a single transaction. Audited on every call.
 */

import { NextResponse, type NextRequest } from "next/server";

import { readSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/perms";
import {
  applyJoinRequestAction,
  type JoinRequestAction,
} from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ACTIONS: ReadonlySet<JoinRequestAction> = new Set([
  "approve",
  "deny",
]);

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ slug: string; userId: string }> }
): Promise<NextResponse> {
  const params = await props.params;
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  if (!can(session.role, "syndicates.write")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const slug = (params.slug ?? "").toLowerCase().trim();
  const userId = (params.userId ?? "").trim();
  if (!slug || !userId) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = body.action as JoinRequestAction | undefined;
  if (!action || !ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ error: "bad_action" }, { status: 400 });
  }

  const outcome = applyJoinRequestAction(slug, userId, action);
  if (outcome.status === "syndicate_not_found") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await writeAudit(session, {
    action: `syndicate.join_request.${action}`,
    target: `syndicate:${slug}/user:${userId}`,
    after: { status: outcome.status, applied_status: action === "approve" ? "active" : "denied" },
  });

  return NextResponse.json({
    ok: true,
    action,
    status: outcome.status,
  });
}
