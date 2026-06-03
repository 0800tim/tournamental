import { NextResponse, type NextRequest } from "next/server";
import { readSession } from "@/lib/auth";
import { Api } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/perms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, props: { params: Promise<{ key: string }> }) {
  const params = await props.params;
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  if (!can(session.role, "feature-flags.write"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { enabled } = (await req.json().catch(() => ({}))) as { enabled?: boolean };
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "bad_payload" }, { status: 400 });
  }

  const r = await Api.toggleFlag(session, params.key, enabled);
  if (!r.ok) return NextResponse.json({ error: "upstream_failed" }, { status: 502 });

  await writeAudit(session, {
    action: "feature_flag.toggle",
    target: params.key,
    after: { enabled },
  });
  return NextResponse.json({ ok: true });
}
