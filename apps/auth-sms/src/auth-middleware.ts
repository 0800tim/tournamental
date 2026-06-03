/**
 * Shared session-authentication helpers used by any route that needs
 * to act on behalf of the signed-in user.
 *
 * Originally lived inline in routes/session.ts; extracted so other
 * routes (phone-link, future profile-side flows) can require auth
 * without duplicating the cookie-or-Bearer extraction + JWT verify +
 * revocation check.
 *
 * Verification has two parts:
 *   1. Cryptographic JWT verify (jose).
 *   2. Session row exists in SQLite (revocation list).
 *
 * The double-check is what makes the JWT revocable: without the row
 * in `session`, the JWT is considered logged out even if it hasn't
 * expired yet.
 */

import type { FastifyRequest } from 'fastify';
import type { AuthContext } from './context.js';
import { verifySessionJwt } from './jwt.js';

export interface AuthedRequest {
  readonly userId: string;
  readonly phone: string;
  readonly jti: string;
}

/**
 * Pull the JWT out of either an `Authorization: Bearer <jwt>` header
 * (the SDK path) or the `tnm_session` cookie set by the inbound-login
 * flow. Cookies take precedence when both are present so a stale
 * Authorization header doesn't mask the browser-driven flow.
 */
export function extractJwt(req: FastifyRequest): string | null {
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader === 'string' && cookieHeader.length > 0) {
    for (const part of cookieHeader.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === 'tnm_session' && rest.length > 0) {
        const value = rest.join('=').trim();
        if (value) return decodeURIComponent(value);
      }
    }
  }
  const header = req.headers.authorization;
  if (typeof header === 'string') {
    const m = /^Bearer\s+(\S+)$/.exec(header);
    if (m) return m[1];
  }
  return null;
}

/**
 * Verify the request's session JWT and confirm the session row is
 * still present (not revoked). Returns null on any failure; callers
 * respond with 401.
 */
export async function authenticate(
  ctx: AuthContext,
  req: FastifyRequest,
): Promise<AuthedRequest | null> {
  const token = extractJwt(req);
  if (!token) return null;
  let claims;
  try {
    claims = await verifySessionJwt({
      secret: ctx.config.jwtSecret,
      token,
    });
  } catch {
    return null;
  }
  const session = ctx.storage.getSessionByJti(claims.jti);
  if (!session) return null;
  const now = Math.floor(ctx.now() / 1000);
  if (session.expires_at < now) return null;
  return { userId: claims.sub, phone: claims.phone, jti: claims.jti };
}
