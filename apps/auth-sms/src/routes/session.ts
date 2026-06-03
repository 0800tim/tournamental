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

import type { FastifyInstance } from 'fastify';
import type { AuthContext } from '../context.js';
import { authenticate } from '../auth-middleware.js';
import { syncUserToHighLevel } from '../highlevel.js';
import { signSessionJwt } from '../jwt.js';

/**
 * Slugify a display_name into a handle (lowercase, [a-z0-9_-] only,
 * 2-32 chars). Mirrors apps/web/lib/share/handle-slug.ts; both ends MUST
 * apply the same transform so the inverse lookup (getUserByHandle)
 * round-trips. We duplicate rather than import because auth-sms is a
 * standalone service and we don't want a cross-app dep.
 */
function slugifyDisplayName(displayName: string | null | undefined): string | null {
  if (!displayName) return null;
  const normalised = displayName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9_-]/g, '');
  if (normalised.length < 2 || normalised.length > 32) return null;
  // Avoid handle shapes that collide with share-guid / auth-sms user-id
  // shapes, the resolver dispatches on shape first.
  if (/^[0-9a-f]{16}$/.test(normalised)) return null;
  if (/^u_[0-9a-f]{16,32}$/.test(normalised)) return null;
  return normalised;
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
      // SEC-AUTH-13: per-IP rate limit so this endpoint can't be used to
      // enumerate display names (it's a public oracle on user identity).
      // 60 requests/min is generous for legitimate share-page traffic
      // (each /s/<handle> load fires one lookup, edge-cached for 60s).
      const ip = (req.ip || '').trim() || '0.0.0.0';
      const nowSec = Math.floor(ctx.now() / 1000);
      const win = 60;
      const bucketStart = Math.floor(nowSec / win) * win;
      const rlKey = `ip:${ip}:by-handle`;
      const count = ctx.storage.bumpRateBucket(rlKey, bucketStart);
      if (count > 60) {
        const retryAfter = bucketStart + win - nowSec;
        reply.header('Retry-After', String(retryAfter));
        return reply.code(429).send({
          error: 'rate-limited',
          retryAfterSeconds: retryAfter,
        });
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

    // SEC-AUTH-09: email changes cannot land via PATCH /v1/auth/me. The
    // previous behaviour let a phone-registered user claim any
    // unregistered email (silently) and surfaced a 409 on collisions
    // (which is itself an enumeration oracle). Email writes now require
    // going through /v1/auth/email/request → /v1/auth/email/verify, then
    // a server-side merge of the verified email onto the user row.
    // Reject email keys here with a generic verification-required status
    // (don't differentiate "taken" vs "not taken" — both are info leaks).
    if ('email' in patch) {
      if (patch.email) {
        const e = patch.email.toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
          return reply.code(400).send({ error: 'bad-email' });
        }
      }
      // Drop the email key — the rest of the patch can still apply.
      delete (patch as Record<string, string | null>).email;
      // Tell the client to start the verification flow.
      reply.header('X-Email-Verification-Required', '1');
    }

    // Display name is the user's public identity and the source for their
    // /s/<handle> URL. Once set, it's immutable — Tim's rule, 2026-06-04:
    // half the share-page bugs traced back to users renaming their
    // display_name and breaking links other people had already shared.
    // The first-set case (existing user has no display_name yet) is still
    // allowed so the first-time name-capture modal works.
    if ('display_name' in patch && patch.display_name) {
      const current = ctx.storage.getUser(authed.userId);
      const currentName = (current?.display_name ?? '').trim();
      if (currentName && currentName !== patch.display_name) {
        return reply.code(403).send({ error: 'display_name_locked' });
      }
      // Format check: 3-32 chars of letters/numbers/underscores after
      // slugifying. The visible display_name can carry spaces ("Tim
      // Thomas") but the slug it produces is what matters for the
      // /s/<handle> URL, so enforce against the slug.
      const slug = slugifyDisplayName(patch.display_name);
      if (!slug || slug.length < 3 || slug.length > 32) {
        return reply.code(400).send({ error: 'display_name_invalid' });
      }
      // Reserved-handle blocklist. These are paths/labels used by the
      // app itself; letting a user squat them would either break routes
      // or allow impersonation of official accounts.
      const RESERVED = new Set<string>([
        'admin', 'administrator', 'api', 'www', 'play', 'you', 'me',
        'anonymous', 'anon', 'deleted', 'support', 'help', 'tournamental',
        'official', 'staff', 'team', 'mod', 'moderator', 'root', 'system',
        'tim', 'null', 'undefined',
      ]);
      if (RESERVED.has(slug)) {
        return reply.code(409).send({ error: 'display_name_reserved' });
      }
      // SEC-PII-03: reject display-name changes whose slug collides with
      // another user. Without this, two users with display_name "Tim Thomas"
      // share /s/timthomas — most-recently-active wins, which lets a fresh
      // signup hijack an established user's share URL.
      const owner = ctx.storage.getUserByHandle(slug);
      if (owner && owner.id !== authed.userId) {
        return reply.code(409).send({ error: 'display_name_taken' });
      }
    }

    // (Email pre-check + display-name pre-check from PR #263 are now
    // superseded by main's SEC-AUTH-09 (email PATCH disabled, must go
    // through /v1/auth/email/verify) and SEC-PII-03 (display-name
    // collision check above), so they're removed here.)

    const now = Math.floor(ctx.now() / 1000);
    let updated;
    try {
      updated = ctx.storage.updateUser(authed.userId, patch, now);
    } catch (err) {
      // SEC-AUTH-09: don't differentiate UNIQUE-email errors from other
      // failures — a 409 'email-taken' here is an enumeration oracle.
      // (We no longer write email via this route, but defensively keep
      // a generic 500 in case of unexpected unique-constraint hits.)
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log.warn({ err: msg, userId: authed.userId }, 'auth: PATCH /me failed');
      return reply.code(500).send({ error: 'update_failed' });
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
