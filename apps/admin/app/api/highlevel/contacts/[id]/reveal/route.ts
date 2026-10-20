/**
 * POST /api/highlevel/contacts/:id/reveal  { kind: "email" | "phone" }
 *
 * Audited reveal for a row on the HighLevel page, which lists CRM
 * contacts by their HighLevel id rather than a Tournamental user id.
 * Re-reads the recent-contacts snapshot (a read, no HighLevel writes),
 * finds the contact, writes `pii.reveal` with target `hl:<id>`, the
 * field, the client IP and the user agent, and returns the value.
 */
import { NextResponse, type NextRequest } from "next/server";
import { readSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { fetchContactsSnapshot, isHighLevelConfigured } from "@/lib/highlevel";
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
  if (!isHighLevelConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  let body: { kind?: unknown } = {};
  try {
    body = (await req.json()) as { kind?: unknown };
  } catch {
    body = {};
  }
  const kind = typeof body.kind === "string" && KINDS.has(body.kind) ? (body.kind as PiiKind) : null;
  if (!kind) return NextResponse.json({ error: "bad_kind" }, { status: 400 });

  const snapshot = await fetchContactsSnapshot(100);
  const contact = snapshot?.recent.find((c) => c.id === params.id) ?? null;
  const value = contact ? (kind === "email" ? contact.email : contact.phone) : null;

  await writeAudit(
    session,
    { action: "pii.reveal", target: `hl:${params.id}`, reason: kind, after: { field: kind, found: value !== null } },
    requestContext(req.headers),
  );

  if (!contact) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, kind, value }, { headers: { "cache-control": "no-store" } });
}
