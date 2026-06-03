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

// Tim 2026-06-04: dual-secret verify. ADMIN_MANAGE_JWT_SECRET signs
// admin-impersonate manage tokens (apps/admin/.../impersonate); the
// existing AUTH_JWT_SECRET signs user-issued manage tokens via the
// /manage-auth OTP flow. Try admin first (rarer, narrower blast
// radius), fall back to user. Both must match the iss/aud below.
const ADMIN_JWT_SECRET = process.env.ADMIN_MANAGE_JWT_SECRET ?? "";
const USER_JWT_SECRET = process.env.AUTH_JWT_SECRET ?? "";
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

  if (!token || (!ADMIN_JWT_SECRET && !USER_JWT_SECRET)) {
    return { ok: false, response: json({ error: "unauthorised" }, 401) };
  }

  const tryVerify = async (secretStr: string): Promise<ManageClaims | null> => {
    if (!secretStr) return null;
    try {
      const secret = new TextEncoder().encode(secretStr);
      // SEC-WEB-02: enforce manage-token issuer + audience so a leaked
      // session/widget cookie can't be replayed as a manage token.
      const { payload } = await jwtVerify(token, secret, {
        issuer: "tournamental-manage",
        audience: "tournamental",
      });
      return payload as unknown as ManageClaims;
    } catch {
      return null;
    }
  };

  const claims = (await tryVerify(ADMIN_JWT_SECRET)) ?? (await tryVerify(USER_JWT_SECRET));
  if (!claims) {
    return { ok: false, response: json({ error: "invalid_token" }, 401) };
  }
  if (claims.type !== "manage" || claims.slug !== slug) {
    return { ok: false, response: json({ error: "forbidden" }, 403) };
  }
  return { ok: true, claims };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(req: NextRequest, props: { params: Promise<{ slug: string }> }): Promise<Response> {
  const params = await props.params;
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

export async function PATCH(req: NextRequest, props: { params: Promise<{ slug: string }> }): Promise<Response> {
  const params = await props.params;
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
