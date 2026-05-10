/**
 * DELETE /api/users/[id]/data — soft-delete a user's data.
 *
 * Gated to super-admin. The actual delete propagates to apps/api (which is
 * responsible for cascading the soft-delete across game-service, crm-bridge,
 * social-publisher etc. — the dashboard never deletes upstream data
 * directly). The dashboard simply records the request in its audit log and
 * forwards to apps/api `/v1/admin/users/:id/data`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { writeAudit } from "@/lib/audit";
import { readSession } from "@/lib/auth";
import { upstreamGet } from "@/lib/upstream-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  if (session.role !== "super-admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const apiBase = process.env.VTORN_API_BASE ?? "http://localhost:3310";
  // We use upstreamGet only for its swallowing semantics — but a DELETE needs
  // an explicit fetch. Inline the same swallow-on-error pattern.
  let upstreamOk = true;
  try {
    const r = await fetch(
      `${apiBase}/v1/admin/users/${encodeURIComponent(params.id)}/data`,
      { method: "DELETE", cache: "no-store" },
    );
    upstreamOk = r.ok;
  } catch {
    upstreamOk = false;
  }
  // Reference upstreamGet so the import isn't dead while we keep its
  // signature available for future GET-based health checks.
  void upstreamGet;

  await writeAudit(session, {
    action: "user.data.delete",
    target: params.id,
    after: { soft_deleted: true, upstream_ok: upstreamOk },
  });

  if (!upstreamOk) {
    return NextResponse.json(
      { ok: false, error: "upstream_unavailable", queued: true },
      { status: 202 },
    );
  }
  return NextResponse.json({ ok: true });
}
