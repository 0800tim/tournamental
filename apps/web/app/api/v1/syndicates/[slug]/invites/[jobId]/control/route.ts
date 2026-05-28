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

import { getPersistence } from "@/lib/syndicate/persistence";
import { getJob, inviteDb, setJobStatus } from "@/lib/invite/store";
import { startInviteRunner } from "@/lib/invite/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JWT_SECRET = process.env.AUTH_JWT_SECRET ?? "";

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
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !JWT_SECRET) return false;
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    const claims = payload as unknown as { slug?: string; type?: string };
    return claims.type === "manage" && claims.slug === slug;
  } catch {
    return false;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string; jobId: string } },
): Promise<Response> {
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
