/**
 * GET /api/admin/syndicates/[slug]/impersonate
 *
 * Mints a short-TTL manage JWT (same shape as the OTP-issued one on
 * apps/auth-sms) so a Tournamental staff admin can act as the pool
 * owner on play.tournamental.com/manage/syndicates/[slug] without
 * having access to the owner's phone OTP.
 *
 * Audit: every mint writes a row to `.admin-audit.jsonl`. The mint
 * is recorded with the actor's email + slug + a short TTL so the
 * trail is obvious.
 *
 * Auth: this route requires a valid admin_session cookie (the
 * existing super-admin gate). Only super-admins can impersonate.
 *
 * Returns a redirect to
 * `https://play.tournamental.com/manage/syndicates/<slug>?admin_token=<jwt>`
 * so the operator can click "Send bulk invites ↗" and land directly
 * in the manage UI.
 *
 * Signing secret: `ADMIN_MANAGE_JWT_SECRET` (NOT the auth-sms
 * `AUTH_JWT_SECRET`). Splitting the secret means a compromised admin
 * surface can mint manage tokens but cannot forge `tnm_session`
 * cookies, and rotating admin-side impersonation does not require
 * rotating the user-session secret. The web app's `verifyManageToken`
 * consumers accept both secrets during the rotation window so this
 * change is forward-compatible. Tracked: SEC-ADMIN-02.
 */

import { NextResponse, type NextRequest } from "next/server";
import { SignJWT } from "jose";

import { readSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANAGE_TTL_SECONDS = 30 * 60; // 30 minutes

export async function GET(req: NextRequest, props: { params: Promise<{ slug: string }> }): Promise<Response> {
  const params = await props.params;
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  if (session.role !== "super-admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const slug = (params.slug ?? "").toLowerCase().trim();
  if (!slug) {
    return NextResponse.json({ error: "bad_slug" }, { status: 400 });
  }

  // The admin-only manage-token signing key. Distinct from
  // AUTH_JWT_SECRET so impersonation can be rotated independently
  // of user sessions. The web app verifies manage tokens against
  // both secrets during the rotation window.
  const secret = process.env.ADMIN_MANAGE_JWT_SECRET;
  if (!secret || secret.length < 32) {
    return NextResponse.json(
      { error: "admin_manage_jwt_secret_missing" },
      { status: 503 },
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + MANAGE_TTL_SECONDS;
  const token = await new SignJWT({
    slug,
    type: "manage",
    // The phone claim is what /manage-auth attaches after OTP. For an
    // admin-minted manage token we use a sentinel string so audit
    // queries can identify them.
    phone: "admin-impersonate",
    impersonated_by: session.email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret));

  await writeAudit(session, {
    action: "syndicate.manage.impersonate",
    target: `syndicate:${slug}`,
    reason: `ttl=${MANAGE_TTL_SECONDS}s`,
  });

  const dest = `https://play.tournamental.com/manage/syndicates/${encodeURIComponent(slug)}?admin_token=${encodeURIComponent(token)}`;
  return NextResponse.redirect(dest, { status: 302 });
}
