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
  display_name: z.string().min(1).max(60).optional(),
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
  const submittedHandle = parsed.success ? parsed.data.handle : undefined;
  const submittedDisplayName = parsed.success ? parsed.data.display_name : undefined;
  const handle = submittedHandle ?? session.displayName ?? null;

  if (!handle || handle.length < 2) {
    return json({ error: "bad_handle", message: "A handle is required to join." }, 400);
  }

  // Handle collision check (per-pool). Skip if the user is rejoining
  // with the SAME handle they already hold in this pool.
  if (
    submittedHandle &&
    persistence.isHandleTakenInSyndicate(row.id, submittedHandle)
  ) {
    const claimedBySomeoneElse = persistence
      .getMembers(row.id)
      .some(
        (m) =>
          !!m.handle &&
          m.handle.toLowerCase() === submittedHandle.toLowerCase() &&
          m.user_id !== session.id,
      );
    if (claimedBySomeoneElse) {
      return json(
        {
          error: "handle_taken",
          message: `Sorry, "${submittedHandle}" is already taken in this pool. Pick a different handle.`,
        },
        409,
      );
    }
  }

  // Insert (or upsert) member row via the persistence API. The new
  // `addMember` helper carries handle + display_name through and
  // returns whether a fresh row was inserted vs an existing row
  // upserted.
  let inserted = false;
  try {
    const r = persistence.addMember({
      syndicate_id: row.id,
      user_id: session.id,
      role: "member",
      handle,
      display_name: submittedDisplayName ?? session.displayName ?? null,
    });
    inserted = r.inserted;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE constraint failed")) {
      return json({ error: "already_member" }, 409);
    }
    throw err;
  }

  if (!inserted) {
    // Already a member (owner re-join or repeat join). Handle /
    // display_name still update via the UPSERT in addMember, so the
    // caller's chosen handle wins for future leaderboards.
    return json({
      ok: true,
      already_member: true,
      member_count: row.member_count,
    });
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
