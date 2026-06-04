/**
 * POST /api/v1/syndicates/[slug]/invites/[jobId]/control
 * Body: { action: 'pause' | 'resume' | 'cancel' }
 *
 * Pauses freeze the runner mid-queue; resume returns to 'running' and
 * the runner picks up. Cancel is terminal. Idempotent.
 */

import { type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { z } from "zod";

import { getSessionFromRequest } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { getPersistence } from "@/lib/syndicate/persistence";
import { getJob, inviteDb, setJobStatus } from "@/lib/invite/store";
import { startInviteRunner } from "@/lib/invite/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tim 2026-06-04: dual-secret verify. ADMIN_MANAGE_JWT_SECRET signs
// admin-impersonate manage tokens; AUTH_JWT_SECRET signs user-issued
// manage tokens via /manage-auth.
const ADMIN_JWT_SECRET = process.env.ADMIN_MANAGE_JWT_SECRET ?? "";
const USER_JWT_SECRET = process.env.AUTH_JWT_SECRET ?? "";

const BodySchema = z.object({
  action: z.enum(["pause", "resume", "cancel"]),
});

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function verifyManageToken(
  req: NextRequest,
  slug: string,
): Promise<boolean> {
  // Super-admin native session bypass (Tim 2026-06-04).
  const session = await getSessionFromRequest(req);
  if (session && isSuperAdmin(session)) return true;

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || (!ADMIN_JWT_SECRET && !USER_JWT_SECRET)) return false;
  const tryVerify = async (
    secretStr: string,
  ): Promise<{ slug?: string; type?: string } | null> => {
    if (!secretStr) return null;
    try {
      const secret = new TextEncoder().encode(secretStr);
      // SEC-WEB-02: scope verification to manage issuer+audience.
      const { payload } = await jwtVerify(token, secret, {
        issuer: "tournamental-manage",
        audience: "tournamental",
      });
      return payload as unknown as { slug?: string; type?: string };
    } catch {
      return null;
    }
  };
  const claims = (await tryVerify(ADMIN_JWT_SECRET)) ?? (await tryVerify(USER_JWT_SECRET));
  if (!claims) return false;
  return claims.type === "manage" && claims.slug === slug;
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ slug: string; jobId: string }> }
): Promise<Response> {
  const params = await props.params;
  const slug = (params.slug ?? "").toLowerCase().trim();
  if (!(await verifyManageToken(req, slug))) {
    return json({ error: "unauthorised" }, 401);
  }
  const syndicate = getPersistence().getBySlug(slug);
  if (!syndicate) return json({ error: "not_found" }, 404);

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "bad_body" }, 400);

  const db = inviteDb();
  if (!db) return json({ error: "queue_unavailable" }, 503);

  const job = getJob(db, params.jobId);
  if (!job || job.syndicate_id !== syndicate.id) {
    return json({ error: "not_found" }, 404);
  }

  const next =
    parsed.data.action === "pause"
      ? "paused"
      : parsed.data.action === "resume"
        ? "running"
        : "cancelled";

  if (job.status === "done" || job.status === "cancelled") {
    return json({ error: "terminal", status: job.status }, 409);
  }

  setJobStatus(db, job.id, next);
  if (next === "running") startInviteRunner();

  return json({ ok: true, status: next });
}
