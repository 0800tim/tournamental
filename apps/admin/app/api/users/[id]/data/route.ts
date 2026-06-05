/**
 * DELETE /api/users/[id]/data — HARD delete a user across auth.db +
 * game.db. Gated to super-admin and audited.
 *
 * Previously this was a soft-delete forwarder to apps/api (which is a
 * stub), so the button on the user-detail page did nothing meaningful.
 * Tim 2026-06-05: real testing of the WhatsApp pool-join flow requires
 * being able to repeatedly recycle the same phone number, so we now do
 * the hard delete locally via `hardDeleteUser` in lib/live.ts. Mirrors
 * the SQL pattern used by the one-off shell delete that triggered this.
 *
 * Wipe scope:
 *   - auth.db: session, phone_otp (by phone), rate_limit (by phone), user
 *   - game.db: brackets, syndicate_owners_membership
 *   - game.db: syndicates.member_count -1 per *active* membership removed
 *
 * Irreversible. The confirm modal on the client requires typing the
 * user_id verbatim before the button fires.
 */

import { NextResponse, type NextRequest } from "next/server";
import { writeAudit } from "@/lib/audit";
import { readSession } from "@/lib/auth";
import { hardDeleteUser } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  if (session.role !== "super-admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const userId = (params.id ?? "").trim();
  if (!userId) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const outcome = hardDeleteUser(userId);

  await writeAudit(session, {
    action: "user.hard_delete",
    target: userId,
    after: {
      status: outcome.status,
      deleted: outcome.deleted,
      member_count_decrements: outcome.member_count_decrements,
    },
  });

  return NextResponse.json({
    ok: outcome.status === "deleted",
    ...outcome,
  });
}
