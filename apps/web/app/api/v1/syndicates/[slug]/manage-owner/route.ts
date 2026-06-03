/**
 * GET/PATCH /api/v1/syndicates/[slug]/manage-owner
 *
 * Owner read + write for syndicate owners authenticating via the
 * OTP manage token (issued by manage-auth). Does not require a
 * Supabase session.
 *
 * Authorization: Bearer <manage_token>
 *
 * GET  — return editable syndicate fields
 * PATCH — update name and/or topic
 */

import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { z } from "zod";

import { getPersistence } from "@/lib/syndicate/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JWT_SECRET = process.env.AUTH_JWT_SECRET ?? "";
const PUBLIC_HOST = process.env.NEXT_PUBLIC_PLAY_HOST ?? "https://play.tournamental.com";

interface ManageClaims {
  slug: string;
  phone: string;
  type: string;
}

async function verifyManageToken(
  req: NextRequest,
  slug: string,
): Promise<{ ok: true; claims: ManageClaims } | { ok: false; response: Response }> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!token || !JWT_SECRET) {
    return { ok: false, response: json({ error: "unauthorised" }, 401) };
  }

  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    // SEC-WEB-02: enforce manage-token issuer + audience so a leaked
    // session/widget cookie can't be replayed as a manage token.
    const { payload } = await jwtVerify(token, secret, {
      issuer: "tournamental-manage",
      audience: "tournamental",
    });
    const claims = payload as unknown as ManageClaims;

    if (claims.type !== "manage" || claims.slug !== slug) {
      return { ok: false, response: json({ error: "forbidden" }, 403) };
    }

    return { ok: true, claims };
  } catch {
    return { ok: false, response: json({ error: "invalid_token" }, 401) };
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } },
): Promise<Response> {
  const slug = (params.slug ?? "").toLowerCase().trim();
  const auth = await verifyManageToken(req, slug);
  if (!auth.ok) return auth.response;

  const row = getPersistence().getBySlug(slug);
  if (!row) return json({ error: "not_found" }, 404);

  return json({
    ok: true,
    syndicate: {
      slug: row.slug,
      name: row.name,
      tier: row.tier,
      member_count: row.member_count,
      share_url: `${PUBLIC_HOST}/s/${row.slug}`,
      share_guid: row.share_guid,
      topic: row.topic,
      size_band: row.size_band,
      branding_primary_colour: row.branding_primary_colour,
      branding_accent_colour: row.branding_accent_colour,
      created_at: row.created_at,
    },
  });
}

const PatchSchema = z.object({
  name: z.string().min(3).max(80).optional(),
  topic: z.string().max(280).nullable().optional(),
}).strict();

export async function PATCH(
  req: NextRequest,
  { params }: { params: { slug: string } },
): Promise<Response> {
  const slug = (params.slug ?? "").toLowerCase().trim();
  const auth = await verifyManageToken(req, slug);
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  }

  const persistence = getPersistence();
  const updated = persistence.updateBranding(slug, parsed.data);
  if (!updated) return json({ error: "not_found" }, 404);

  return json({
    ok: true,
    syndicate: {
      slug: updated.slug,
      name: updated.name,
      topic: updated.topic,
    },
  });
}
