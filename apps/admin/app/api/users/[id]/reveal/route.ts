/**
 * POST /api/users/:id/reveal  { kind: "email" | "phone" }
 *
 * Returns the unmasked value for one field of a user's CRM contact after
 * writing an audit entry (`pii.reveal`) with the operator, the target,
 * the field, the client IP and the user agent. Every admin view shows
 * phone and email masked by default and calls this on "Show".
 *
 * Reads only: the contact comes from the same `fetchCustomer360` the
 * page uses. No HighLevel writes.
 */
import { NextResponse, type NextRequest } from "next/server";
import { readSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { fetchCustomer360 } from "@/lib/customer360";
import { can } from "@/lib/perms";
import { requestContext, type PiiKind } from "@/lib/pii";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: ReadonlySet<string> = new Set(["email", "phone"]);

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  if (!can(session.role, "users.read")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: { kind?: unknown } = {};
  try {
    body = (await req.json()) as { kind?: unknown };
  } catch {
    body = {};
  }
  const kind = typeof body.kind === "string" && KINDS.has(body.kind) ? (body.kind as PiiKind) : null;
  if (!kind) return NextResponse.json({ error: "bad_kind" }, { status: 400 });

  const c360 = await fetchCustomer360(params.id);
  const contact = c360.crmContact;
  const value = contact ? (kind === "email" ? contact.email : contact.phone) ?? null : null;

  await writeAudit(
    session,
    { action: "pii.reveal", target: params.id, reason: kind, after: { field: kind, found: value !== null } },
    requestContext(req.headers),
  );

  return NextResponse.json({ ok: true, kind, value }, { headers: { "cache-control": "no-store" } });
}
