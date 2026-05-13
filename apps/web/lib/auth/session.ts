/**
 * Server-side session verification for Next.js API routes.
 *
 * The auth-sms service mints HS256 JWTs and sets them as the
 * `tnm_session` cookie on `.tournamental.com`. The play app's Next.js
 * API routes (this module's callers) verify those cookies with the
 * same secret to identify the user behind a request.
 *
 * The cookie format matches `apps/auth-sms/src/jwt.ts` exactly:
 *   - HS256 signature with `AUTH_JWT_SECRET`
 *   - issuer: `tournamental-auth`
 *   - audience: `tournamental`
 *   - sub: user_id
 *   - phone: E.164 or empty
 *   - jti: unique session id
 *
 * Why this lives here and not in `@/lib/auth/inbound-login.ts`: that
 * module is a *client* of the auth-sms HTTP API, used by browser
 * components to ask "am I signed in?". This module is the *server-side*
 * cookie verifier, used by route handlers that need to gate an
 * endpoint on a real authenticated session.
 *
 * Keep this module's surface tiny: one helper, returns null on any
 * failure (no exceptions for missing/invalid cookies; those are the
 * normal "guest visitor" case).
 */

import { jwtVerify } from "jose";

export interface SessionUser {
  /** The auth-sms `u_<hex>` user id. */
  readonly userId: string;
  /** E.164 phone or null when the user authed via a non-phone provider. */
  readonly phone: string | null;
  /** Unique session id; useful for revocation checks if we ever wire one. */
  readonly jti: string;
}

const ISSUER = "tournamental-auth";
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

/**
 * Verify the `tnm_session` cookie on a request and return the
 * resolved user, or null if the cookie is absent, invalid, expired,
 * or the secret is unconfigured. Never throws.
 */
export async function getSessionFromRequest(
  req: { headers: { get(name: string): string | null } },
): Promise<SessionUser | null> {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || secret.length < 16) return null;

  const cookieHeader = req.headers.get("cookie");
  const token = readCookie(cookieHeader, COOKIE_NAME);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: ISSUER,
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
    return { userId: payload.sub, phone, jti };
  } catch {
    return null;
  }
}
