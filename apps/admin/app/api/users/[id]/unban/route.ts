import { NextResponse, type NextRequest } from "next/server";
import { readSession } from "@/lib/auth";
import { Api } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/perms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  if (!can(session.role, "users.unban")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const r = await Api.unbanUser(session, params.id);
  if (!r.ok) return NextResponse.json({ error: "upstream_failed" }, { status: 502 });

  await writeAudit(session, {
    action: "user.unban",
    target: params.id,
    after: { status: "active" },
  });
  return NextResponse.json({ ok: true });
}
