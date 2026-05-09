import { NextResponse, type NextRequest } from "next/server";
import { readSession } from "@/lib/auth";
import { Api } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/perms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  if (!can(session.role, "users.ban")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { reason } = (await req.json().catch(() => ({}))) as { reason?: string };
  if (!reason || reason.trim().length < 3) {
    return NextResponse.json({ error: "reason_required" }, { status: 400 });
  }

  const r = await Api.banUser(session, params.id, reason);
  if (!r.ok) return NextResponse.json({ error: "upstream_failed" }, { status: 502 });

  await writeAudit(session, {
    action: "user.ban",
    target: params.id,
    reason,
    after: { status: "banned" },
  });
  return NextResponse.json({ ok: true });
}
