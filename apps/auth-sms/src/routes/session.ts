/**
 * Session routes:
 *
 *   GET  /v1/auth/me                — return the authed user.
 *   POST /v1/auth/session/refresh   — issue a fresh JWT (rolling session).
 *   POST /v1/auth/session/logout    — revoke the current session.
 *
 * All require a valid Bearer JWT. Verification has two checks:
 *   1. Cryptographic JWT verify (jose).
 *   2. Session row exists in SQLite (revocation list).
 *
 * The double check is what makes the JWT *revocable* — without the
 * row in the `session` table, the JWT is considered logged out even
 * if it hasn't expired yet.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthContext } from '../context.js';
import { verifySessionJwt, signSessionJwt } from '../jwt.js';

interface AuthedRequest {
  userId: string;
  phone: string;
  jti: string;
}

/**
 * Pull the JWT out of either an `Authorization: Bearer <jwt>` header
 * (the original SDK path) or the `tnm_session` cookie set by the
 * inbound-login flow at /v1/auth/magic-verify and /v1/auth/verify-by-code.
 * Cookies take precedence when both are present so the browser-driven
 * flow doesn't get masked by a stale Authorization header.
 */
function extractJwt(req: FastifyRequest): string | null {
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

async function authenticate(
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
  // Revocation check.
  const session = ctx.storage.getSessionByJti(claims.jti);
  if (!session) return null;
  const now = Math.floor(ctx.now() / 1000);
  if (session.expires_at < now) return null;
  return { userId: claims.sub, phone: claims.phone, jti: claims.jti };
}

export async function registerSession(
  app: FastifyInstance,
  ctx: AuthContext,
): Promise<void> {
  app.get('/v1/auth/me', async (req, reply) => {
    const authed = await authenticate(ctx, req);
    if (!authed) return reply.code(401).send({ error: 'unauthorized' });
    const user = ctx.storage.getUser(authed.userId);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    reply.header('Cache-Control', 'private, no-store');
    return reply.send({
      user: {
        id: user.id,
        phone: user.phone,
        displayName: user.display_name,
        country: user.country,
        createdAt: user.created_at,
        lastSeenAt: user.last_seen_at,
      },
    });
  });

  app.post('/v1/auth/session/refresh', async (req, reply) => {
    const authed = await authenticate(ctx, req);
    if (!authed) return reply.code(401).send({ error: 'unauthorized' });
    const user = ctx.storage.getUser(authed.userId);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    // Revoke the old session, issue a fresh one (rotation).
    ctx.storage.revokeSessionByJti(authed.jti);

    const now = Math.floor(ctx.now() / 1000);
    const signed = await signSessionJwt({
      secret: ctx.config.jwtSecret,
      userId: user.id,
      phone: user.phone ?? '',
      ttlSeconds: ctx.config.sessionTtlSeconds,
    });
    ctx.storage.insertSession({
      id: signed.jti,
      user_id: user.id,
      jwt_jti: signed.jti,
      created_at: now,
      expires_at: signed.expiresAt,
      user_agent:
        typeof req.headers['user-agent'] === 'string'
          ? req.headers['user-agent'].slice(0, 256)
          : null,
      ip: req.ip || null,
    });
    return reply.send({
      ok: true,
      jwt: signed.jwt,
      expiresAt: signed.expiresAt,
    });
  });

  app.post('/v1/auth/session/logout', async (req, reply) => {
    const authed = await authenticate(ctx, req);
    if (!authed) return reply.code(401).send({ error: 'unauthorized' });
    ctx.storage.revokeSessionByJti(authed.jti);
    return reply.send({ ok: true });
  });
}
