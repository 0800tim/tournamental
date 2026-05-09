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

async function authenticate(
  ctx: AuthContext,
  req: FastifyRequest,
): Promise<AuthedRequest | null> {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/.exec(header);
  if (!m) return null;
  let claims;
  try {
    claims = await verifySessionJwt({
      secret: ctx.config.jwtSecret,
      token: m[1],
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
      phone: user.phone,
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
