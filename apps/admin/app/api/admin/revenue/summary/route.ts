import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { can } from "@/lib/perms";
import { revenueSummary } from "@/lib/ops-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  if (!can(session.role, "revenue.read"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const summary = await revenueSummary();
  return NextResponse.json(summary);
}
