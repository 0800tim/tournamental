/**
 * POST /v1/auth/magic-verify
 *
 * Front-end calls this when a user lands on
 * `https://play.tournamental.com?v=<token>` after tapping the
 * one-tap sign-in link from the inbound-login WhatsApp / SMS reply.
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

/**
 * In-memory dedupe for very recent successful verifications.
 *
 * Problem: a 200 response can race with a duplicate submission (the
 * user double-taps "Sign in", the browser retries on a flaky network,
 * or React Strict Mode in dev fires the handler twice). The first
 * request consumes the OTP row; the second finds nothing and returns
 * 401 — and that 401 is the response the user actually sees because
 * it overwrites the in-flight success state.
 *
 * Fix: when a verify succeeds, stash the dedupe key for 60s. On the
 * next verify-by-code / magic-verify call, if the active-OTP scan
 * misses but the dedupe map has a match AND the requesting
 * fingerprint matches the binding from the original successful
 * verify, treat the duplicate as legitimate and mint a fresh session.
 *
 * The dedupe key:
 *   verify-by-code:  the raw 6-digit code
 *   magic-verify:    the challenge token (64 hex chars)
 *
 * Both are unique per-OTP and short-lived, so the map stays small
 * (bounded by the OTP-issuance rate × 60s). Process-local; a restart
 * clears it, which is fine — the user simply requests a fresh code.
 */
interface DedupeEntry {
  userId: string;
  phone: string | null;
  uaFp: string;
  ip: string;
  expiresAt: number;
}
const RECENT_VERIFY = new Map<string, DedupeEntry>();
const DEDUPE_TTL_SECONDS = 60;

function pruneDedupe(nowSeconds: number): void {
  for (const [k, v] of RECENT_VERIFY) {
    if (v.expiresAt <= nowSeconds) RECENT_VERIFY.delete(k);
  }
}

export function rememberRecentVerify(
  key: string,
  entry: Omit<DedupeEntry, 'expiresAt'>,
  nowSeconds: number,
): void {
  pruneDedupe(nowSeconds);
  RECENT_VERIFY.set(key, {
    ...entry,
    expiresAt: nowSeconds + DEDUPE_TTL_SECONDS,
  });
}

export function findRecentVerify(
  key: string,
  nowSeconds: number,
): DedupeEntry | null {
  pruneDedupe(nowSeconds);
  const e = RECENT_VERIFY.get(key);
  return e && e.expiresAt > nowSeconds ? e : null;
}

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
  /** Idempotency key: raw code (verify-by-code) or challenge token
      (magic-verify). On success, this key is remembered for 60s so a
      duplicate submission from the same fingerprint replays the same
      sign-in instead of erroring. */
  dedupeKey?: string;
}): Promise<void> {
  const { ctx, reply, phone, ip, uaFp, pid, source, dedupeKey } = opts;
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

  // Remember this verification for 60s so a duplicate submission from
  // the same fingerprint can be replayed without erroring. The
  // dedupeKey is the raw code or challenge token — short-lived and
  // already gated by fingerprint matching on the replay path.
  if (dedupeKey) {
    rememberRecentVerify(
      dedupeKey,
      { userId: user.id, phone: user.phone, uaFp, ip },
      now,
    );
  }

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

/**
 * Replay path: a recent successful verify dedupe-hit. We trust the
 * remembered user-id (already authenticated 60s ago from this exact
 * fingerprint) and just mint a fresh session + cookie. No OTP row to
 * delete, no audit churn beyond the dedupe note.
 */
export async function mintReplaySession(opts: {
  ctx: AuthContext;
  req: FastifyRequest;
  reply: FastifyReply;
  userId: string;
  phone: string | null;
  ip: string;
  pid: string;
  source: 'magic' | 'code';
}): Promise<void> {
  const { ctx, req, reply, userId, phone, ip, pid, source } = opts;
  const now = Math.floor(ctx.now() / 1000);

  const user = ctx.storage.getUser(userId);
  if (!user) {
    return reply.code(401).send({ error: 'unknown-or-expired' });
  }
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
      truncateUa(
        typeof req.headers['user-agent'] === 'string'
          ? req.headers['user-agent']
          : undefined,
      ) ?? null,
    ip,
  });
  reply.header(
    'Set-Cookie',
    buildSessionCookie({
      jwt: signed.jwt,
      ttlSeconds: ctx.config.sessionTtlSeconds,
      cookieDomain: ctx.config.inboundCookieDomain,
    }),
  );
  ctx.audit.write({
    action: source === 'magic' ? 'inbound.magic.replay' : 'inbound.code.replay',
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
      phone: phone ?? user.phone,
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
      // Dedupe replay: if this same token was successfully verified
      // in the last 60s from the same fingerprint, mint a fresh
      // session rather than erroring (handles browser back/forward,
      // double-fire, retry on flaky network).
      const replay = findRecentVerify(token, now);
      if (replay && replay.uaFp === uaFp) {
        return mintReplaySession({
          ctx,
          req,
          reply,
          userId: replay.userId,
          phone: replay.phone,
          ip,
          pid: replay.phone ? phoneLogId(replay.phone) : '',
          source: 'magic',
        });
      }
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
      dedupeKey: token,
    });
  });
}

export { clientIp, uaFingerprint };
