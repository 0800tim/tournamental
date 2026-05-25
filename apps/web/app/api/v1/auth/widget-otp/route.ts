/**
 * POST /api/v1/auth/widget-otp  - cross-origin inline OTP sign-in.
 *
 * This is the engine behind the embed widget's *inline* sign-in box: a
 * partner-site visitor can request a one-time code and verify it without
 * ever leaving the embed, and without relying on third-party cookies
 * (which Safari ITP / Firefox ETP / Chrome cookie-partitioning block on
 * cross-origin iframes and fetches).
 *
 * Two actions on one CORS-open endpoint:
 *
 *   { action: "request", channel: "email" | "sms" | "whatsapp",
 *     email?, phone? }
 *       -> proxies to auth-sms (/v1/auth/email/request or /v1/auth/request)
 *          which sends the code out-of-band. Returns { ok } (never the code).
 *
 *   { action: "verify", channel, email? | phone?, code }
 *       -> proxies to auth-sms verify. On success we DROP the session
 *          cookie auth-sms tries to set (it's useless cross-origin) and
 *          instead mint a *widget bearer token* (issuer tournamental-widget,
 *          scope "widget") bound to the verified user id. The widget stores
 *          this in its own first-party localStorage and sends it as
 *          `Authorization: Bearer <token>` on every later call.
 *          Returns { ok, token, expires_at, user: { id } }.
 *
 * Why mint here rather than reuse the auth-sms session JWT: the bearer
 * path in lib/auth/session.ts only trusts the `tournamental-widget`
 * issuer + `scope: "widget"`, so an auth-sms session token can never be
 * replayed as a widget bearer (and vice-versa). This route is the only
 * bridge, and it only crosses after a real OTP verify.
 *
 * CORS: open (any origin) because the whole point is third-party embeds.
 * Credentials are NOT used (no cookies cross this boundary), so echoing
 * the origin + allowing the Authorization/Content-Type headers is safe.
 */

import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_API = process.env.AUTH_API_URL ?? "http://localhost:3330";
const WIDGET_ISSUER = "tournamental-widget";
const AUDIENCE = "tournamental";
const TTL_SECONDS = 24 * 60 * 60; // 24h, matches /widget-token.

const RequestSchema = z.object({
  action: z.literal("request"),
  channel: z.enum(["email", "sms", "whatsapp"]),
  email: z.string().email().max(254).optional(),
  phone: z.string().min(1).max(32).optional(),
  pool_slug: z.string().regex(/^[a-z0-9-]{1,64}$/i).optional(),
});

const VerifySchema = z.object({
  action: z.literal("verify"),
  channel: z.enum(["email", "sms", "whatsapp"]),
  email: z.string().email().max(254).optional(),
  phone: z.string().min(1).max(32).optional(),
  code: z.string().min(4).max(10).regex(/^\d+$/),
});

const BodySchema = z.discriminatedUnion("action", [RequestSchema, VerifySchema]);

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}

function json(req: NextRequest, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders(req) });
}

export function OPTIONS(req: NextRequest): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: NextRequest): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = null;
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return json(req, { error: "bad_body" }, 400);
  const data = parsed.data;

  // Resolve the auth-sms endpoint + payload for this channel.
  const isEmail = data.channel === "email";
  if (isEmail && !data.email) return json(req, { error: "email_required" }, 400);
  if (!isEmail && !data.phone) return json(req, { error: "phone_required" }, 400);

  if (data.action === "request") {
    const path = isEmail ? "/v1/auth/email/request" : "/v1/auth/request";
    const payload = isEmail
      ? { email: data.email }
      : { phone: data.phone, channel: data.channel, pool_slug: data.pool_slug };
    try {
      const res = await fetch(`${AUTH_API}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      // Pass the upstream status through so the widget can show
      // cooldown / rate-limit messaging. Never includes the code.
      return json(
        req,
        res.ok ? { ok: true, channel: data.channel, ...out } : { error: out.error ?? "request_failed", ...out },
        res.status,
      );
    } catch {
      return json(req, { error: "upstream_unreachable" }, 502);
    }
  }

  // action === "verify"
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || secret.length < 16) {
    return json(req, { error: "auth_unconfigured" }, 503);
  }

  const path = isEmail ? "/v1/auth/email/verify" : "/v1/auth/verify";
  const payload = isEmail
    ? { email: data.email, code: data.code }
    : { phone: data.phone, code: data.code };

  let user: { id?: string } | undefined;
  try {
    const res = await fetch(`${AUTH_API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      user?: { id?: string };
    };
    if (!res.ok || !out.ok || !out.user?.id) {
      return json(req, { error: out.error ?? "verify_failed" }, res.status === 200 ? 401 : res.status);
    }
    user = out.user;
  } catch {
    return json(req, { error: "upstream_unreachable" }, 502);
  }

  // Verified. Mint a widget bearer bound to this user id.
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + TTL_SECONDS;
  const jti = randomUUID();
  const token = await new SignJWT({ jti, scope: "widget" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id as string)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setIssuer(WIDGET_ISSUER)
    .setAudience(AUDIENCE)
    .setJti(jti)
    .sign(new TextEncoder().encode(secret));

  return json(req, {
    ok: true,
    token,
    expires_at: expiresAt,
    user: { id: user.id },
  });
}
