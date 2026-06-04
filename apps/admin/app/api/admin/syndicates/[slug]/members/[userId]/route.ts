/**
 * DELETE /api/admin/syndicates/[slug]/members/[userId]
 *
 * Admin-side member removal: drops the membership row from
 * `syndicate_owners_membership` and decrements the syndicate's cached
 * `member_count`, in a single transaction. Idempotent — a second call
 * for an already-removed user returns 200 with `not_in_pool`.
 *
 * Auth: admin_session cookie + `syndicates.write` permission. Same
 * guard as the join-request handler so anyone who can approve members
 * can also remove them.
 *
 * Tim 2026-06-04: surfaced as the "Remove user" link next to "Open
 * user" on the admin syndicate detail page.
 */

import { NextResponse, type NextRequest } from "next/server";

import { readSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/perms";
import { removeMemberFromSyndicate } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ slug: string; userId: string }> },
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

  const outcome = removeMemberFromSyndicate(slug, userId);
  if (outcome.status === "syndicate_not_found") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await writeAudit(session, {
    action: "syndicate.member.remove",
    target: `syndicate:${slug}/user:${userId}`,
    after: { status: outcome.status },
  });

  return NextResponse.json({ ok: true, status: outcome.status });
}
