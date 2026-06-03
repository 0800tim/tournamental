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
import { syncUserToHighLevel } from '../highlevel.js';
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

/**
 * Shape we serialise user records into on the wire. camelCase per
 * REST convention; everything is nullable except id and createdAt.
 */
function serialiseUser(user: import('../storage.js').UserRecord) {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    displayName: user.display_name,
    firstName: user.first_name,
    lastName: user.last_name,
    country: user.country,
    city: user.city,
    favouriteTeamCode: user.favourite_team_code,
    telegramUsername: user.telegram_username,
    createdAt: user.created_at,
    lastSeenAt: user.last_seen_at,
  };
}

/**
 * Pruned-down user shape returned by the public lookup endpoint. Only
 * the fields safe to surface to a stranger viewing someone else's
 * share page: identifier, display name, first name, country.
 *
 * Crucially excludes phone, email, last_seen_at and any session data.
 */
function serialiseUserPublic(user: import('../storage.js').UserRecord) {
  return {
    id: user.id,
    displayName: user.display_name,
    firstName: user.first_name,
    country: user.country,
    city: user.city,
    favouriteTeamCode: user.favourite_team_code,
  };
}

export async function registerSession(
  app: FastifyInstance,
  ctx: AuthContext,
): Promise<void> {
  // Public profile lookup — no auth required. Powers the /s/<guid>
  // share page so the visitor sees the bracket owner's chosen display
  // name instead of "Anonymous". Returns only the non-PII fields.
  app.get<{ Params: { id: string } }>('/v1/auth/users/:id/public', async (req, reply) => {
    const id = (req.params.id ?? '').trim();
    if (!id || !/^[a-zA-Z0-9_-]{4,128}$/.test(id)) {
      return reply.code(400).send({ error: 'bad_id' });
    }
    const user = ctx.storage.getUser(id);
    if (!user) return reply.code(404).send({ error: 'not_found' });
    reply.header('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
    return reply.send({ user: serialiseUserPublic(user) });
  });

  // Resolve a friendly handle (slugified display_name) to a user.
  // Powers /s/<handle> short share URLs on play.tournamental.com.
  // Public, no-auth, edge-cached briefly (handles can change when a
  // user renames their display_name, but rename is rare). Returns the
  // same public-profile shape as /:id/public so the web caller can
  // hand off straight to the share-landing renderer.
  // Tim 2026-05-24, see docs/61 and apps/web/lib/share/handle-slug.ts.
  app.get<{ Params: { handle: string } }>(
    '/v1/auth/users/by-handle/:handle',
    async (req, reply) => {
      const handle = (req.params.handle ?? '').trim();
      if (!handle || !/^[a-zA-Z0-9_-]{2,32}$/.test(handle)) {
        return reply.code(400).send({ error: 'bad_handle' });
      }
      const user = ctx.storage.getUserByHandle(handle);
      if (!user) return reply.code(404).send({ error: 'not_found' });
      reply.header(
        'Cache-Control',
        'public, s-maxage=60, stale-while-revalidate=300',
      );
      return reply.send({ user: serialiseUserPublic(user) });
    },
  );

  app.get('/v1/auth/me', async (req, reply) => {
    const authed = await authenticate(ctx, req);
    if (!authed) return reply.code(401).send({ error: 'unauthorized' });
    const user = ctx.storage.getUser(authed.userId);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    reply.header('Cache-Control', 'private, no-store');
    return reply.send({
      user: serialiseUser(user),
    });
  });

  app.patch('/v1/auth/me', async (req, reply) => {
    const authed = await authenticate(ctx, req);
    if (!authed) return reply.code(401).send({ error: 'unauthorized' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, string | null> = {};
    const stringField = (
      key: 'display_name' | 'country' | 'email' | 'first_name' | 'last_name' | 'city' | 'favourite_team_code',
      maxLen: number,
    ): void => {
      if (!(key in body)) return;
      const v = body[key];
      if (v === null || v === undefined || v === '') {
        patch[key] = null;
        return;
      }
      if (typeof v !== 'string') return;
      const trimmed = v.trim().slice(0, maxLen);
      patch[key] = trimmed.length > 0 ? trimmed : null;
    };
    stringField('display_name', 80);
    stringField('country', 2);
    stringField('email', 254);
    stringField('first_name', 80);
    stringField('last_name', 80);
    stringField('city', 80);
    stringField('favourite_team_code', 3);

    if (patch.country) patch.country = patch.country.toUpperCase();
    if (patch.favourite_team_code) patch.favourite_team_code = patch.favourite_team_code.toUpperCase();
    if (patch.email) {
      const e = patch.email.toLowerCase();
      // Tight format check; the server rejects rather than the client.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
        return reply.code(400).send({ error: 'bad-email' });
      }
      patch.email = e;
    }

    // Tim 2026-06-04: explicit pre-check for email collision.  The
    // user.email UNIQUE index is still the source of truth (the catch
    // below handles races between check and write), but resolving the
    // collision before the UPDATE means a clean 409 + no audit-log
    // noise from a near-miss INSERT.  Phone isn't reachable through
    // this handler at all (no stringField for it), so the only way to
    // change a phone number is the verified-OTP signup flow, which
    // upserts on verified possession, so it cannot be used to hijack.
    if (
      'email' in patch &&
      patch.email !== null &&
      typeof patch.email === 'string' &&
      patch.email.length > 0
    ) {
      const me = ctx.storage.getUser(authed.userId);
      if (patch.email !== (me?.email ?? null)) {
        const collider = ctx.storage.getUserByEmail(patch.email);
        if (collider && collider.id !== authed.userId) {
          return reply.code(409).send({ error: 'email-taken' });
        }
      }
    }

    // Tim 2026-06-04: enforce display-name uniqueness server-side.
    // The /s/<handle> share routes use slugifyDisplayName(display_name)
    // as the URL key; if two users slugify to the same handle the
    // resolver picks "most recently active wins" which silently
    // hijacks someone else's pretty URL.  Block at write time instead.
    // Slug rule mirrors apps/web/lib/share/handle-slug.ts.
    if (
      'display_name' in patch &&
      patch.display_name !== null &&
      typeof patch.display_name === 'string'
    ) {
      const slug = (s: string | null | undefined): string =>
        (s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9_-]/g, '');
      const proposed = slug(patch.display_name);
      // Empty / too-short proposals can't collide with a handle-shaped
      // value, so they skip the check.
      if (proposed.length >= 2 && proposed.length <= 32) {
        const me = ctx.storage.getUser(authed.userId);
        const myCurrentSlug = slug(me?.display_name ?? null);
        // Only check when the proposed slug actually changes; users
        // updating capitalisation or whitespace keep resolving to the
        // same handle and shouldn't trip the check.
        if (proposed !== myCurrentSlug) {
          const collider = ctx.storage.getUserByHandle(proposed);
          if (collider && collider.id !== authed.userId) {
            return reply.code(409).send({ error: 'display-name-taken' });
          }
        }
      }
    }

    const now = Math.floor(ctx.now() / 1000);
    let updated;
    try {
      updated = ctx.storage.updateUser(authed.userId, patch, now);
    } catch (err) {
      // Most likely cause: duplicate email (unique constraint).
      const msg = err instanceof Error ? err.message : String(err);
      if (/UNIQUE constraint failed.*email/.test(msg)) {
        return reply.code(409).send({ error: 'email-taken' });
      }
      throw err;
    }
    if (!updated) return reply.code(404).send({ error: 'not-found' });

    // Re-sync to HighLevel when an identity field changed (name, country,
    // email). Fire-and-forget; the contact-id writeback only touches the
    // highlevel_* columns, which aren't identity fields, so this can't loop.
    const identityKeys = ['display_name', 'first_name', 'last_name', 'country', 'email'] as const;
    if (identityKeys.some((k) => k in patch)) {
      void syncUserToHighLevel(ctx.storage, updated, { now, log: ctx.log });
    }

    reply.header('Cache-Control', 'private, no-store');
    return reply.send({ user: serialiseUser(updated) });
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
