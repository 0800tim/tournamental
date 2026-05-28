/**
 * GET /api/v1/syndicates/[slug]/invites/[jobId]
 *   Job detail + per-recipient progress (capped at 500 rows).
 *
 * POST /api/v1/syndicates/[slug]/invites/[jobId]/control
 *   Body: { action: 'pause' | 'resume' | 'cancel' | 'retry' }
 *   Only the pool owner (manage JWT scoped to this slug) may act.
 */

import { type NextRequest } from "next/server";
import { jwtVerify } from "jose";

import { getPersistence } from "@/lib/syndicate/persistence";
import {
  getJob,
  inviteDb,
  listRecipients,
  setJobStatus,
} from "@/lib/invite/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JWT_SECRET = process.env.AUTH_JWT_SECRET ?? "";

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

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string; jobId: string } },
): Promise<Response> {
  const slug = (params.slug ?? "").toLowerCase().trim();
  if (!(await verifyManageToken(req, slug))) {
    return json({ error: "unauthorised" }, 401);
  }
  const syndicate = getPersistence().getBySlug(slug);
  if (!syndicate) return json({ error: "not_found" }, 404);

  const db = inviteDb();
  if (!db) return json({ error: "queue_unavailable" }, 503);

  const job = getJob(db, params.jobId);
  if (!job || job.syndicate_id !== syndicate.id) {
    return json({ error: "not_found" }, 404);
  }

  const recipients = listRecipients(db, job.id, 500).map((r) => ({
    id: r.id,
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    phone_e164: r.phone_e164,
    status: r.status,
    sent_at: r.sent_at ? new Date(r.sent_at).toISOString() : null,
    error: r.error,
    channel_result: safeParse(r.channel_result_json),
  }));

  return json({
    job: {
      job_id: job.id,
      status: job.status,
      channels: job.channels,
      throttle_ms: job.throttle_ms,
      total: job.total,
      sent: job.sent,
      failed: job.failed,
      skipped: job.skipped,
      message_body: job.message_body,
      created_at: new Date(job.created_at).toISOString(),
      updated_at: new Date(job.updated_at).toISOString(),
      completed_at: job.completed_at
        ? new Date(job.completed_at).toISOString()
        : null,
    },
    recipients,
  });
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
