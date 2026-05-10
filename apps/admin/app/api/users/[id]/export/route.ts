/**
 * GET /api/users/[id]/export — full customer-360 aggregate as a downloadable
 * JSON file. Gated to super-admin (operators of lower tiers can see the data
 * in-page but cannot export it as a portable artefact).
 *
 * The export combines:
 *   - the upstream apps/api user record (via lib/api.ts)
 *   - the six customer-360 sections (via lib/customer360.ts)
 *
 * Each export is recorded in the audit log as `user.export`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { Api } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { readSession } from "@/lib/auth";
import { fetchCustomer360 } from "@/lib/customer360";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  if (session.role !== "super-admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [user, customer360] = await Promise.all([
    Api.user(session, params.id),
    fetchCustomer360(params.id),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    exportedBy: session.email,
    user,
    customer360,
  };

  await writeAudit(session, {
    action: "user.export",
    target: params.id,
  });

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="customer-360-${params.id}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
