/**
 * Bulk-invite job lifecycle.
 *
 *   POST /api/v1/syndicates/[slug]/invites
 *     Body:
 *       {
 *         message_body: string (1..1000 chars; supports {{first_name}},
 *                                {{pool_name}}, {{owner_name}}, {{join_url}}),
 *         channels: ('whatsapp'|'email')[],
 *         throttle_ms?: number (default 1000),
 *         contacts: { first_name?, last_name?, email?, phone_e164?, source_row? }[]
 *       }
 *     Creates the job + recipients, marks status='running', kicks off
 *     the in-process runner. Returns the new job id and total.
 *
 *   GET /api/v1/syndicates/[slug]/invites
 *     Lists the syndicate's recent invite jobs with counts.
 *
 * Auth: manage JWT (Bearer) issued by /manage-auth, scoped to this slug.
 * No write goes through without a verified slug match.
 */

import { type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { z } from "zod";

import { getPersistence } from "@/lib/syndicate/persistence";
import {
  buildWarmInviteUrl,
  type InviteContact,
} from "@/lib/invite/parse-csv";
import {
  createInviteJob,
  getJob,
  inviteDb,
  listJobsForSyndicate,
  startJob,
} from "@/lib/invite/store";
import { startInviteRunner } from "@/lib/invite/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JWT_SECRET = process.env.AUTH_JWT_SECRET ?? "";
const PUBLIC_HOST = process.env.NEXT_PUBLIC_PLAY_HOST ?? "https://play.tournamental.com";

const ContactSchema = z.object({
  first_name: z.string().max(80).nullable().optional(),
  last_name: z.string().max(80).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone_e164: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/)
    .nullable()
    .optional(),
});

const PostSchema = z.object({
  message_body: z.string().min(1).max(1000),
  channels: z.array(z.enum(["whatsapp", "email"])).min(1),
  throttle_ms: z.number().int().min(250).max(60_000).optional(),
  contacts: z.array(ContactSchema).min(1).max(10_000),
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
): Promise<{ ok: true; phone: string } | { ok: false; response: Response }> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !JWT_SECRET) {
    return { ok: false, response: json({ error: "unauthorised" }, 401) };
  }
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    // SEC-WEB-02: scope verification to manage issuer+audience.
    const { payload } = await jwtVerify(token, secret, {
      issuer: "tournamental-manage",
      audience: "tournamental",
    });
    const claims = payload as unknown as {
      slug?: string;
      phone?: string;
      type?: string;
    };
    if (claims.type !== "manage" || claims.slug !== slug) {
      return { ok: false, response: json({ error: "forbidden" }, 403) };
    }
    return { ok: true, phone: claims.phone ?? "unknown" };
  } catch {
    return { ok: false, response: json({ error: "invalid_token" }, 401) };
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
): Promise<Response> {
  const slug = (params.slug ?? "").toLowerCase().trim();
  if (!slug) return json({ error: "bad_slug" }, 400);

  const auth = await verifyManageToken(req, slug);
  if (!auth.ok) return auth.response;

  const syndicate = getPersistence().getBySlug(slug);
  if (!syndicate) return json({ error: "not_found" }, 404);

  const parsed = PostSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "bad_body", details: parsed.error.flatten() }, 400);
  }
  const body = parsed.data;

  // Filter contacts down to those that actually have a usable channel
  // for the requested channels. The CSV parser already does this on
  // the client; this is the server-side belt-and-braces.
  const cleaned: ReadonlyArray<{
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phoneE164: string | null;
    warmUrl: string;
  }> = body.contacts
    .map((c, i) => ({
      firstName: c.first_name ?? null,
      lastName: c.last_name ?? null,
      email: c.email ?? null,
      phoneE164: c.phone_e164 ?? null,
      sourceRow: i + 1,
    }))
    .filter((c) => {
      if (body.channels.includes("whatsapp") && c.phoneE164) return true;
      if (body.channels.includes("email") && c.email) return true;
      return false;
    })
    .map((c) => ({
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phoneE164: c.phoneE164,
      warmUrl: buildWarmInviteUrl({
        slug,
        contact: c as InviteContact,
        origin: PUBLIC_HOST,
        ref: `csv-${Date.now().toString(36)}`,
      }),
    }));

  if (cleaned.length === 0) {
    return json({ error: "no_valid_recipients" }, 400);
  }

  const db = inviteDb();
  if (!db) {
    return json({ error: "queue_unavailable" }, 503);
  }

  const { jobId, total } = createInviteJob(db, {
    syndicateId: syndicate.id,
    syndicateSlug: slug,
    createdBy: auth.phone,
    createdByKind: "owner",
    channels: body.channels,
    messageBody: body.message_body,
    throttleMs: body.throttle_ms ?? 1000,
    recipients: cleaned,
  });

  // Move to 'running' so the runner picks it up.
  startJob(db, jobId);
  startInviteRunner();

  return json({ ok: true, job_id: jobId, total });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } },
): Promise<Response> {
  const slug = (params.slug ?? "").toLowerCase().trim();
  if (!slug) return json({ error: "bad_slug" }, 400);

  const auth = await verifyManageToken(req, slug);
  if (!auth.ok) return auth.response;

  const syndicate = getPersistence().getBySlug(slug);
  if (!syndicate) return json({ error: "not_found" }, 404);

  const db = inviteDb();
  if (!db) return json({ jobs: [] });

  const jobs = listJobsForSyndicate(db, syndicate.id, 25).map((j) => ({
    job_id: j.id,
    status: j.status,
    total: j.total,
    sent: j.sent,
    failed: j.failed,
    skipped: j.skipped,
    channels: j.channels,
    throttle_ms: j.throttle_ms,
    created_at: new Date(j.created_at).toISOString(),
    updated_at: new Date(j.updated_at).toISOString(),
    completed_at: j.completed_at ? new Date(j.completed_at).toISOString() : null,
    created_by: j.created_by,
    created_by_kind: j.created_by_kind,
  }));

  return json({ jobs });
}
