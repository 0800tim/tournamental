/**
 * GET /api/v1/_debug/session
 *
 * TEMPORARY diagnostic endpoint to figure out why /api/v1/syndicates/mine
 * returns 401 for users who are clearly signed in (display_name + email
 * loading via auth-sms /v1/auth/me, but local session check missing).
 *
 * Returns a JSON snapshot of:
 *   - The cookie names the server sees on the request
 *   - Whether tnm_session is present + its JWT header (no payload)
 *   - The result of getSessionFromRequest (userId only)
 *   - The result of forwarding the cookie to auth-sms /v1/auth/me
 *
 * No PII leaks: we never echo cookie values, only their names + lengths.
 * userId is fine to surface because the user calling this endpoint
 * owns it.
 *
 * Remove after the 401 root cause is identified (Tim 2026-05-24).
 */

import type { NextRequest } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonResponse(body: unknown): Response {
  return Response.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

function parseCookieNames(header: string | null): Array<{ name: string; length: number }> {
  if (!header) return [];
  return header
    .split(/;\s*/)
    .map((p) => {
      const eq = p.indexOf("=");
      if (eq < 0) return { name: p, length: 0 };
      const name = p.slice(0, eq);
      const valueLen = p.slice(eq + 1).length;
      return { name, length: valueLen };
    })
    .filter((c) => c.name.length > 0);
}

function jwtHeaderOnly(token: string): unknown {
  try {
    const [h] = token.split(".");
    return JSON.parse(Buffer.from(h, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function probeAuthSms(req: NextRequest): Promise<unknown> {
  const base = (
    process.env.AUTH_API_BASE ??
    process.env.AUTH_API_URL ??
    process.env.NEXT_PUBLIC_AUTH_BASE_URL ??
    process.env.NEXT_PUBLIC_AUTH_API_URL ??
    "http://localhost:3330"
  ).replace(/\/+$/, "");
  const cookie = req.headers.get("cookie") ?? "";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 800);
  try {
    const res = await fetch(`${base}/v1/auth/me`, {
      signal: ctrl.signal,
      headers: { accept: "application/json", cookie },
    });
    clearTimeout(timer);
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text.slice(0, 200);
    }
    return {
      base,
      status: res.status,
      // Only surface the id from /v1/auth/me, not phone / email / etc.
      userId:
        typeof parsed === "object" &&
        parsed !== null &&
        "user" in parsed &&
        typeof (parsed as { user: { id?: unknown } }).user?.id === "string"
          ? (parsed as { user: { id: string } }).user.id
          : null,
      ok: res.ok,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      base,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const cookieHeader = req.headers.get("cookie");
  const cookies = parseCookieNames(cookieHeader);
  const tnmSessionCookie = cookies.find((c) => c.name === "tnm_session") ?? null;

  // Try to peek at the JWT header (alg + typ only, no payload).
  let tnmJwtHeader: unknown = null;
  if (tnmSessionCookie) {
    const raw = (cookieHeader ?? "")
      .split(/;\s*/)
      .map((p) => {
        const eq = p.indexOf("=");
        if (eq < 0) return ["", ""] as const;
        return [p.slice(0, eq), decodeURIComponent(p.slice(eq + 1))] as const;
      })
      .find(([n]) => n === "tnm_session");
    if (raw && raw[1]) {
      tnmJwtHeader = jwtHeaderOnly(raw[1]);
    }
  }

  const session = await getSessionFromRequest(req);
  const authSms = await probeAuthSms(req);

  return jsonResponse({
    request_url: req.url,
    host: req.headers.get("host"),
    cookies_present: cookies.map((c) => ({
      name: c.name,
      length: c.length,
    })),
    tnm_session_present: !!tnmSessionCookie,
    tnm_session_jwt_header: tnmJwtHeader,
    local_session: session
      ? { userId: session.userId, via: session.via }
      : null,
    auth_sms_probe: authSms,
    env_secrets_present: {
      AUTH_JWT_SECRET: !!process.env.AUTH_JWT_SECRET,
      NEXT_PUBLIC_AUTH_BASE_URL: process.env.NEXT_PUBLIC_AUTH_BASE_URL ?? null,
      NEXT_PUBLIC_AUTH_API_URL: process.env.NEXT_PUBLIC_AUTH_API_URL ?? null,
    },
  });
}
