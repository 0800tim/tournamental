import { NextResponse, type NextRequest } from "next/server";
import { readSession } from "@/lib/auth";
import { can } from "@/lib/perms";
import { writeAudit } from "@/lib/audit";
import {
  getOperator,
  patchOperator,
  shallowDiff,
  type OperatorRecord,
} from "@/lib/ops-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATCHABLE_KEYS = new Set<keyof OperatorRecord>([
  "name",
  "kind",
  "affiliate_url_pattern",
  "geo_allow",
  "geo_deny",
  "revenue_share_pct",
  "status",
  "contact_email",
  "notes",
]);

export async function GET(_req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  if (!can(session.role, "operators.read"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const op = await getOperator(params.slug);
  if (!op) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(op);
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  if (!can(session.role, "operators.write"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const safe: Partial<OperatorRecord> = {};
  for (const k of Object.keys(body)) {
    if (PATCHABLE_KEYS.has(k as keyof OperatorRecord)) {
      (safe as Record<string, unknown>)[k] = body[k];
    }
  }

  try {
    const { before, after } = await patchOperator(params.slug, safe);
    const diff = shallowDiff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    );
    await writeAudit(session, {
      action: "operator.patch",
      target: `operator:${params.slug}`,
      before: diff.before,
      after: diff.after,
    });
    return NextResponse.json(after);
  } catch (e) {
    const err = e as Error & { compliance?: true };
    if (err.message === "not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (err.compliance) {
      return NextResponse.json(
        { error: "compliance_violation", reason: err.message },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
