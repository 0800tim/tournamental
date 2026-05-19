/**
 * POST /api/v1/syndicates/[slug]/join
 *
 * Adds the authenticated user to the syndicate as a member.
 * Requires an active tnm_session cookie (issued by auth-sms after
 * WhatsApp / Telegram sign-in). Anonymous joins are rejected.
 *
 * Body: { handle?: string }
 *   handle is only required if the user's session doesn't already have
 *   one set. Clients should send it whenever the join modal asks for it.
 *
 * Responses:
 *   200  { ok: true, member_count: number }
 *   400  { error: "bad_handle" | "no_session" | "bad_slug" }
 *   404  { error: "not_found" }
 *   409  { error: "already_member" }
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { getPersistence } from "@/lib/syndicate/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_API = process.env.AUTH_API_URL ?? "http://localhost:3330";

const BodySchema = z.object({
  handle: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_]+$/).optional(),
});

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Probe the tnm_session cookie via auth-sms /v1/auth/me. */
async function resolveSession(req: NextRequest): Promise<{
  id: string;
  phone: string | null;
  displayName: string | null;
} | null> {
  const cookie = req.cookies.get("tnm_session")?.value;
  if (!cookie) return null;
  try {
    const res = await fetch(`${AUTH_API}/v1/auth/me`, {
      headers: { Cookie: `tnm_session=${cookie}` },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      user?: { id?: string; phone?: string | null; displayName?: string | null };
    };
    const u = j.user;
    if (!u?.id) return null;
    return { id: u.id, phone: u.phone ?? null, displayName: u.displayName ?? null };
  } catch {
    return null;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
): Promise<Response> {
  const slug = (params.slug ?? "").toLowerCase().trim();
  if (!slug) return json({ error: "bad_slug" }, 400);

  const session = await resolveSession(req);
  if (!session) return json({ error: "no_session" }, 401);

  const persistence = getPersistence();
  const row = persistence.getBySlug(slug);
  if (!row) return json({ error: "not_found" }, 404);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = BodySchema.safeParse(body);
  const handle = parsed.success ? (parsed.data.handle ?? session.displayName ?? null) : session.displayName ?? null;

  if (!handle || handle.length < 2) {
    return json({ error: "bad_handle", message: "A handle is required to join." }, 400);
  }

  // Insert member row. The membership table's PRIMARY KEY (syndicate_id,
  // user_id) plus ON CONFLICT DO NOTHING means a duplicate self-join is
  // silently absorbed — `changes` will be 0 in that case. We must check
  // it explicitly: incrementing member_count unconditionally was the
  // root cause of the spurious "member_1/2/3" entries on the landing
  // page, because the renderer used to synthesise members from the
  // cached count.
  let inserted = 0;
  try {
    const result = (persistence as unknown as {
      insertMemberStmt: { run: (args: Record<string, unknown>) => { changes: number } };
    }).insertMemberStmt?.run({
      syndicate_id: row.id,
      user_id: session.id,
      role: "member",
      joined_at: Date.now(),
    });
    inserted = result?.changes ?? 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE constraint failed")) {
      return json({ error: "already_member" }, 409);
    }
    throw err;
  }

  if (inserted === 0) {
    // Already a member (owner re-join or repeat join). Return the
    // current count untouched.
    return json({ error: "already_member", member_count: row.member_count }, 409);
  }

  // Bump the cached member_count on the syndicates row. The game
  // service owns the authoritative count; this is an optimistic update
  // so the landing page reflects the new join immediately.
  try {
    (persistence as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } })
      .db
      .prepare(`UPDATE syndicates SET member_count = member_count + 1 WHERE id = ?`)
      .run(row.id);
  } catch {
    // Non-fatal — member_count is eventually consistent via game service.
  }

  return json({ ok: true, member_count: row.member_count + 1 });
}
