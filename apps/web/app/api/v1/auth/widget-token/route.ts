/**
 * POST /api/v1/auth/widget-token
 *
 * Issues a short-lived bearer token to the *just-authenticated* user
 * inside the popup, so the embed widget on a partner page (different
 * origin from play.tournamental.com) can authenticate subsequent
 * API calls without relying on third-party cookies.
 *
 * Flow:
 *   1. User clicks "Log in" in the embed widget on, e.g.,
 *      netpotential.co.nz/about-us/careers.
 *   2. Widget opens play.tournamental.com/auth/popup in a popup.
 *   3. User completes OTP / Telegram / email-link auth -> tnm_session
 *      cookie is set on .tournamental.com.
 *   4. AuthPopupClient POSTs to THIS route (first-party, cookie is
 *      sent normally) and gets back { token, expires_at }.
 *   5. Popup postMessages { ok, token, expires_at, user } to its
 *      opener (the widget on the partner page).
 *   6. Widget stores the token in its own localStorage on the
 *      partner's origin and sends "Authorization: Bearer <token>"
 *      on every subsequent /api/v1/* call.
 *
 * The token issuer is `tournamental-widget` (NOT `tournamental-auth`
 * like the session cookie) so it can never be replayed as a cookie
 * and vice versa. Includes a `scope: "widget"` claim so server-side
 * auth resolution can tighten checks on sensitive endpoints later.
 *
 * Cache-Control: no-store. Authentication: requires a valid session
 * cookie (the user must already be logged in -- this endpoint mints
 * a delegated credential, it does NOT authenticate).
 */

import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { SignJWT } from "jose";

import { getSessionFromRequest } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WIDGET_ISSUER = "tournamental-widget";
const AUDIENCE = "tournamental";
const TTL_SECONDS = 24 * 60 * 60; // 24h -- shorter than the multi-day session cookie.

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || secret.length < 16) {
    return json({ error: "auth_unconfigured" }, 503);
  }

  // Require an already-authenticated session cookie. Bearer-token
  // auth is rejected here so a widget token can't be used to mint
  // another widget token (no chain-extension).
  const session = await getSessionFromRequest(req);
  if (!session) return json({ error: "unauthorised" }, 401);
  if (session.via !== "cookie") return json({ error: "cookie_required" }, 401);

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + TTL_SECONDS;
  const jti = randomUUID();

  const token = await new SignJWT({
    phone: session.phone ?? undefined,
    jti,
    scope: "widget",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(session.userId)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setIssuer(WIDGET_ISSUER)
    .setAudience(AUDIENCE)
    .setJti(jti)
    .sign(new TextEncoder().encode(secret));

  return json({
    token,
    expires_at: expiresAt,
    user: { id: session.userId },
  });
}
