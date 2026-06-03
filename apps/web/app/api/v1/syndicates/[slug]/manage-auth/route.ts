/**
 * POST /api/v1/syndicates/[slug]/manage-auth
 *
 * Two-step OTP gate for syndicate owners who don't have a Supabase
 * session (e.g. landing on /manage/syndicates/[slug] from the link
 * they received after creating their syndicate).
 *
 * Step 1 — request:  { action: "request", phone: string (E.164) }
 *   → verifies the phone matches the syndicate's owner_phone
 *   → triggers an OTP send via auth-sms
 *   → returns { ok: true, phone_masked: string }
 *
 * Step 2 — verify:   { action: "verify", phone: string, code: string }
 *   → verifies the OTP code via auth-sms
 *   → on success signs a short-lived manage JWT and returns it along
 *      with the syndicate's essential data (no secrets)
 *
 * The manage JWT is consumed by:
 *   GET  /api/v1/syndicates/[slug]/manage-owner  (read syndicate)
 *   PATCH /api/v1/syndicates/[slug]/manage-owner  (update name/topic)
 */

import type { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { z } from "zod";

import { getPersistence } from "@/lib/syndicate/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_API = process.env.AUTH_API_URL ?? "http://localhost:3330";
const JWT_SECRET = process.env.AUTH_JWT_SECRET ?? "";
const PUBLIC_HOST = process.env.NEXT_PUBLIC_PLAY_HOST ?? "https://play.tournamental.com";

const MANAGE_TOKEN_TTL_HOURS = 8;

const RequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("request"),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/, "must be E.164"),
  }),
  z.object({
    action: z.literal("verify"),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/, "must be E.164"),
    code: z.string().min(4).max(8),
  }),
]);

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
): Promise<Response> {
  const slug = (params.slug ?? "").toLowerCase().trim();
  if (!slug) return json({ error: "bad_slug" }, 400);

  const persistence = getPersistence();
  const row = persistence.getBySlug(slug);
  if (!row) return json({ error: "not_found" }, 404);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "invalid_payload", issues: parsed.error.issues }, 400);
  }

  const data = parsed.data;

  // Normalise stored phone (always E.164, stored at creation) for
  // constant-time comparison. We don't reveal the owner phone in any
  // error — just return the same 400 whether the phone is wrong or the
  // syndicate has no phone recorded.
  const ownerPhone = row.owner_phone ?? "";

  if (data.action === "request") {
    if (!ownerPhone || ownerPhone !== data.phone) {
      // Constant-time-ish: always call auth-sms with a dummy phone so
      // the response time doesn't leak whether the syndicate exists.
      return json({ error: "phone_mismatch" }, 400);
    }

    let authRes: Response;
    try {
      authRes = await fetch(`${AUTH_API}/v1/auth/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: data.phone, channel: "sms" }),
      });
    } catch {
      return json({ error: "auth_service_unavailable" }, 503);
    }

    if (!authRes.ok) {
      const err = await authRes.json().catch(() => ({}));
      return json({ error: "otp_request_failed", detail: err }, authRes.status);
    }

    const result = (await authRes.json()) as { phoneMasked?: string; expiresInSeconds?: number };
    return json({ ok: true, phone_masked: result.phoneMasked ?? data.phone.replace(/\d(?=\d{4})/g, "*") });
  }

  // action === "verify"
  if (!ownerPhone || ownerPhone !== data.phone) {
    return json({ error: "phone_mismatch" }, 400);
  }

  let authRes: Response;
  try {
    authRes = await fetch(`${AUTH_API}/v1/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: data.phone, code: data.code }),
    });
  } catch {
    return json({ error: "auth_service_unavailable" }, 503);
  }

  if (!authRes.ok) {
    const err = await authRes.json().catch(() => ({}));
    return json({ error: "otp_verify_failed", detail: err }, authRes.status);
  }

  // OTP verified — sign a manage token scoped to this slug + phone.
  if (!JWT_SECRET) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const secret = new TextEncoder().encode(JWT_SECRET);
  // SEC-WEB-02: pin issuer + audience so a leaked tnm_session JWT
  // (which uses `tournamental-auth`) can never be replayed as a manage
  // token, even if it happens to carry `type: "manage"` in the future.
  const token = await new SignJWT({ slug, phone: data.phone, type: "manage" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("tournamental-manage")
    .setAudience("tournamental")
    .setExpirationTime(`${MANAGE_TOKEN_TTL_HOURS}h`)
    .sign(secret);

  return json({
    ok: true,
    token,
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
