/**
 * Server-side session verification for Next.js API routes.
 *
 * Two parallel auth paths are accepted (transparent to callers):
 *
 *   1. **Cookie**: `tnm_session=<jwt>` minted by `apps/auth-sms` after a
 *      successful OTP / Telegram / email-link verify. Issuer
 *      `tournamental-auth`, audience `tournamental`. This is the path
 *      every browser session uses for first-party play.tournamental.com
 *      traffic.
 *
 *   2. **Bearer**: `Authorization: Bearer <jwt>` minted by
 *      `POST /api/v1/auth/widget-token` (this app). Issuer
 *      `tournamental-widget`, audience `tournamental`, includes a
 *      `scope: "widget"` claim. This is the cross-origin path used by
 *      the embed widget on partner pages where third-party-cookie
 *      blocking (Safari ITP / Firefox ETP / Chrome's partitioning of
 *      SameSite=None cookies) stops the cookie path from working.
 *
 * Both paths produce the same `SessionUser` shape. `via` lets callers
 * tighten checks (e.g. refuse a widget token on account-mutation
 * endpoints).
 *
 * Why distinct issuers: a session cookie should never be replayable as
 * a bearer (and vice versa). The widget JWT has its own issuer string
 * so jose's verifier rejects cookie tokens passed via Authorization
 * and rejects widget tokens dropped into a cookie jar.
 *
 * Keep this module's surface tiny: one helper, returns null on any
 * failure (no exceptions; the unauthenticated case is normal).
 */

import { jwtVerify } from "jose";

export interface SessionUser {
  /** The auth-sms `u_<hex>` user id. */
  readonly userId: string;
  /** E.164 phone or null when the user authed via a non-phone provider. */
  readonly phone: string | null;
  /** Unique session id; useful for revocation checks if we ever wire one. */
  readonly jti: string;
  /** Which transport delivered the credential. */
  readonly via: "cookie" | "widget";
}

const COOKIE_ISSUER = "tournamental-auth";
const WIDGET_ISSUER = "tournamental-widget";
const AUDIENCE = "tournamental";
const COOKIE_NAME = "tnm_session";

function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  const parts = header.split(/;\s*/);
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    if (p.slice(0, eq) === name) {
      return decodeURIComponent(p.slice(eq + 1));
    }
  }
  return null;
}

function readBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+([^\s,]+)/i.exec(header);
  return m ? m[1] : null;
}

async function verifyAsCookieJwt(secret: string, token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: COOKIE_ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
    const phone =
      typeof payload.phone === "string" && payload.phone.length > 0
        ? payload.phone
        : null;
    const jti = typeof payload.jti === "string" ? payload.jti : "";
    if (!jti) return null;
    return { userId: payload.sub, phone, jti, via: "cookie" };
  } catch {
    return null;
  }
}

async function verifyAsWidgetJwt(secret: string, token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: WIDGET_ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
    if (payload.scope !== "widget") return null;
    const phone =
      typeof payload.phone === "string" && payload.phone.length > 0
        ? payload.phone
        : null;
    const jti = typeof payload.jti === "string" ? payload.jti : "";
    if (!jti) return null;
    return { userId: payload.sub, phone, jti, via: "widget" };
  } catch {
    return null;
  }
}

/**
 * Resolve the authenticated user for a request. Tries the cookie path
 * first (zero-latency for first-party traffic) then falls back to a
 * bearer token (cross-origin widget path). Returns null when neither
 * path produces a valid session.
 */
export async function getSessionFromRequest(
  req: { headers: { get(name: string): string | null } },
): Promise<SessionUser | null> {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || secret.length < 16) return null;

  const cookieToken = readCookie(req.headers.get("cookie"), COOKIE_NAME);
  if (cookieToken) {
    const user = await verifyAsCookieJwt(secret, cookieToken);
    if (user) return user;
  }

  const bearerToken = readBearer(req.headers.get("authorization"));
  if (bearerToken) {
    const user = await verifyAsWidgetJwt(secret, bearerToken);
    if (user) return user;
  }

  return null;
}
