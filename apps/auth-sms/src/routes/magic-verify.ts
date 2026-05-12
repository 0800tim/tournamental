/**
 * POST /v1/auth/magic-verify
 *
 * Front-end calls this when a user lands on
 * `https://tournamental.com?v=<token>` after tapping the one-tap
 * sign-in link from the inbound-login WhatsApp / SMS reply.
 *
 * Request body:   { token: string (64 hex chars) }
 * Response 200:   { jwt, expiresAt, user: { id, phone, displayName?, country? } }
 *                 plus Set-Cookie: tnm_session=<jwt>; Domain=.tournamental.com; ...
 * Response 400:   { error: 'bad-body' }
 * Response 401:   { error: 'unknown-or-expired' }   // token not found, expired, or attempts exceeded
 * Response 403:   { error: 'fingerprint-mismatch' } // bound to a different device on first use
 *
 * Security model (Tournamental-specific, see PR description):
 *
 *   1. Per-code attempt cap (`inboundMagicMaxAttempts`, default 5).
 *      Burns the row after the cap regardless of IP — the primary
 *      brute-force defence and the only one that's IP-independent.
 *
 *   2. IP + UA fingerprint binding on FIRST USE (not at issuance).
 *      The user requests the code from their phone but typically
 *      verifies on a desktop browser, so we cannot bind at issuance.
 *      We bind to whichever IP/UA fingerprint first attempts
 *      verification, and reject any subsequent attempt from a
 *      different fingerprint.
 *
 *   3. NO per-IP rate limit on this endpoint. Tournamental users in
 *      a shared office NAT (20+ people behind one public IP) may all
 *      sign in simultaneously after a launch email. The per-code
 *      cap above provides brute-force protection without punishing
 *      legitimate co-located users. (The /v1/auth/verify-by-code
 *      route has a separate, generous per-IP cap that fires ONLY on
 *      blind-guessing patterns — wrong codes that don't match any
 *      active OTP.)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AuthContext } from '../context.js';
import { phoneLogId } from '../storage.js';
import { signSessionJwt } from '../jwt.js';
import { truncateUa } from '../audit.js';

const BodySchema = z.object({
  token: z.string().length(64).regex(/^[a-f0-9]+$/i),
});

function clientIp(req: FastifyRequest): string {
  return (req.ip || '').trim() || '0.0.0.0';
}

/**
 * Short hex fingerprint of (user-agent || accept-language). Both
 * headers are stable across page reloads on the same device, so the
 * fingerprint provides a second axis of binding alongside IP — a
 * meaningful defence even on shared mobile-carrier IPs.
 */
function uaFingerprint(req: FastifyRequest): string {
  const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '';
  const lang =
    typeof req.headers['accept-language'] === 'string'
      ? req.headers['accept-language']
      : '';
  return createHash('sha256').update(`${ua}|${lang}`).digest('hex').slice(0, 16);
}

/**
 * Build the Set-Cookie value for the inbound-flow session cookie.
 * Apex-domain so it's sent on both tournamental.com (marketing) and
 * play.tournamental.com (web app). HttpOnly + Secure + SameSite=Lax
 * is the standard hardening posture.
 */
export function buildSessionCookie(opts: {
  jwt: string;
  ttlSeconds: number;
  cookieDomain: string;
}): string {
  const parts = [
    `tnm_session=${opts.jwt}`,
    `Domain=${opts.cookieDomain}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${opts.ttlSeconds}`,
  ];
  return parts.join('; ');
}

/**
 * Shared bind-and-mint flow used by both magic-verify and
 * verify-by-code. Caller has already located the OTP row and confirmed
 * the code (or token) matches. We bind to first-use fingerprint, mint
 * the JWT, delete the row, and set the cookie.
 */
export async function bindAndMintSession(opts: {
  ctx: AuthContext;
  req: FastifyRequest;
  reply: FastifyReply;
  phone: string;
  channel: 'sms' | 'whatsapp';
  ip: string;
  uaFp: string;
  pid: string;
  source: 'magic' | 'code';
}): Promise<void> {
  const { ctx, reply, phone, ip, uaFp, pid, source } = opts;
  const now = Math.floor(ctx.now() / 1000);

  // Bind on first use. If the row was already bound, this returns the
  // existing fingerprint and we cross-check; mismatch is the
  // "attacker who stole the link" or "user tried the link on a
  // different network mid-flight" case.
  const bind = ctx.storage.bindOtpToFingerprint({ phone, ip, uaFp });
  if (!bind.bound) {
    if (bind.existingIp !== ip || bind.existingFp !== uaFp) {
      ctx.storage.incrementMagicAttempts(phone);
      ctx.audit.write({
        action: 'inbound.magic.fingerprint-mismatch',
        phoneId: pid,
        ip,
        ua: undefined,
        reason: source,
      });
      return reply.code(403).send({ error: 'fingerprint-mismatch' });
    }
    // Same fingerprint, second attempt with the same row — harmless
    // (e.g. browser reload). Fall through to mint a fresh session.
  }

  const user = ctx.storage.findOrCreateUser(phone, now);
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
    user_agent: truncateUa(
      typeof opts.req.headers['user-agent'] === 'string'
        ? opts.req.headers['user-agent']
        : undefined,
    ) ?? null,
    ip,
  });
  // OTP row is consumed regardless of new-vs-returning so the same
  // code / magic link cannot be replayed.
  ctx.storage.deleteOtp(phone);

  reply.header(
    'Set-Cookie',
    buildSessionCookie({
      jwt: signed.jwt,
      ttlSeconds: ctx.config.sessionTtlSeconds,
      cookieDomain: ctx.config.inboundCookieDomain,
    }),
  );
  ctx.audit.write({
    action: source === 'magic' ? 'inbound.magic.ok' : 'inbound.code.ok',
    phoneId: pid,
    ip,
    ua: undefined,
    reason: source,
  });
  return reply.code(200).send({
    jwt: signed.jwt,
    expiresAt: signed.expiresAt,
    user: {
      id: user.id,
      phone: user.phone,
      displayName: user.display_name,
      country: user.country,
    },
  });
}

export async function registerMagicVerify(
  app: FastifyInstance,
  ctx: AuthContext,
): Promise<void> {
  app.post('/v1/auth/magic-verify', async (req, reply) => {
    const ip = clientIp(req);
    const uaFp = uaFingerprint(req);

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad-body' });
    }
    const token = parsed.data.token;
    const now = Math.floor(ctx.now() / 1000);

    ctx.storage.pruneExpiredOtps(now);

    const row = ctx.storage.getOtpByChallenge(token);
    if (!row) {
      ctx.audit.write({
        action: 'inbound.magic.unknown',
        phoneId: '',
        ip,
        ua: undefined,
        reason: 'no-row',
      });
      return reply.code(401).send({ error: 'unknown-or-expired' });
    }
    if (row.expires_at < now) {
      ctx.storage.deleteOtp(row.phone);
      ctx.audit.write({
        action: 'inbound.magic.expired',
        phoneId: phoneLogId(row.phone),
        ip,
        ua: undefined,
        reason: 'ttl',
      });
      return reply.code(401).send({ error: 'unknown-or-expired' });
    }
    if (row.magic_attempts >= ctx.config.inboundMagicMaxAttempts) {
      ctx.storage.deleteOtp(row.phone);
      ctx.audit.write({
        action: 'inbound.magic.attempts-exceeded',
        phoneId: phoneLogId(row.phone),
        ip,
        ua: undefined,
        reason: String(row.magic_attempts),
      });
      return reply.code(401).send({ error: 'unknown-or-expired' });
    }

    return bindAndMintSession({
      ctx,
      req,
      reply,
      phone: row.phone,
      channel: row.channel,
      ip,
      uaFp,
      pid: phoneLogId(row.phone),
      source: 'magic',
    });
  });
}

export { clientIp, uaFingerprint };
