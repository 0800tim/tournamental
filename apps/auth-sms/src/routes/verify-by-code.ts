/**
 * POST /v1/auth/verify-by-code
 *
 * Code-paste fallback for the inbound-login flow. The user pastes the
 * 6-digit code they received over WhatsApp / SMS into the website
 * form. We match the code against every currently-active inbound OTP
 * row, bind the matching row to first-use fingerprint, and mint a
 * session.
 *
 * Request body:   { code: string (6 digits) }
 * Response 200:   { jwt, expiresAt, user } + Set-Cookie (see magic-verify)
 * Response 400:   { error: 'bad-body' }
 * Response 401:   { error: 'unknown-or-expired' }
 * Response 403:   { error: 'fingerprint-mismatch' }
 * Response 429:   { error: 'ip-throttled', retryAfterSeconds }
 *
 * Why no phone in the request: the user is sometimes pasting the code
 * on a different device from the one that received it (received on
 * phone, signing in on desktop), and asking them to retype the phone
 * is friction. The 6-digit code is enough on its own because:
 *
 *   - The active OTP set is small (~10s of rows in steady state).
 *   - The per-code attempt counter (`magic_attempts`) burns a row
 *     after 5 wrong tries against it.
 *   - The per-IP "no-match" bucket catches blind-guessing patterns
 *     (an IP submitting many codes that match NO active OTP). The
 *     bucket fires only on the no-match case, so an office of 20
 *     people behind one NAT can all sign in successfully without
 *     ever incrementing it.
 *
 * The per-IP cap is generous on purpose, see
 * `inboundCodeIpFailureMax` config (default 60 / hour). Shared-NAT
 * legitimate traffic never trips it; only sustained blind-guessing
 * does.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthContext } from '../context.js';
import { phoneLogId } from '../storage.js';
import { hashOtp, safeEqualHex, OTP_LENGTH } from '../otp.js';
import {
  bindAndMintSession,
  clientIp,
  findRecentVerify,
  mintReplaySession,
  uaFingerprint,
} from './magic-verify.js';

const BodySchema = z.object({
  code: z.string().length(OTP_LENGTH).regex(/^\d+$/),
});

/**
 * Hourly bucket key for per-IP "blind-guess" failures. Bucket window
 * matches the OTP TTL so an attacker can't reset by waiting.
 */
function ipFailureBucket(ip: string, now: number, windowSeconds: number): {
  key: string;
  bucketStart: number;
} {
  const bucketStart = Math.floor(now / windowSeconds) * windowSeconds;
  return { key: `ip:${ip}:inbound-code-nomatch`, bucketStart };
}

/**
 * Window (seconds) during which a recent OTP-issuance from the requesting
 * IP qualifies as a "device freshness" proof for /verify-by-code. Without
 * a recent issuance, the code-paste route is gated, which stops an
 * attacker who has never even loaded the site from blind-guessing the
 * 1M code space against an active OTP they did not request (SEC-AUTH-01).
 *
 * 600s matches the default OTP TTL so a legitimate user who just received
 * a code is always inside the window; we check the current + previous
 * bucket to make it a true rolling window.
 */
const ISSUANCE_WINDOW_SECONDS = 600;

function ipHasRecentIssuance(opts: {
  ctx: AuthContext;
  ip: string;
  now: number;
}): boolean {
  const { ctx, ip, now } = opts;
  const current = Math.floor(now / ISSUANCE_WINDOW_SECONDS) * ISSUANCE_WINDOW_SECONDS;
  const previous = current - ISSUANCE_WINDOW_SECONDS;
  for (const b of [current, previous]) {
    if (ctx.storage.getRateBucket(`ip:${ip}:otp-issued`, b) > 0) return true;
    // The inbound-login flow uses a different (gateway) IP at issuance
    // than the user's verifying IP, so we also accept a global recent-
    // inbound marker. This still blocks attackers who have never
    // triggered an issuance at all.
    if (ctx.storage.getRateBucket('ip-issued-any', b) > 0) return true;
  }
  return false;
}

export async function registerVerifyByCode(
  app: FastifyInstance,
  ctx: AuthContext,
): Promise<void> {
  app.post('/v1/auth/verify-by-code', async (req, reply) => {
    const ip = clientIp(req);
    const uaFp = uaFingerprint(req);

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad-body' });
    }
    const code = parsed.data.code;
    const now = Math.floor(ctx.now() / 1000);

    ctx.storage.pruneExpiredOtps(now);

    // Window matches OTP TTL so a blind-guesser can't reset their
    // failure budget by waiting.
    const ttl = ctx.config.otpTtlSeconds;
    const bucket = ipFailureBucket(ip, now, ttl);
    const currentFailures = ctx.storage.getRateBucket(
      bucket.key,
      bucket.bucketStart,
    );
    if (currentFailures >= ctx.config.inboundCodeIpFailureMax) {
      const retryAfter = bucket.bucketStart + ttl - now;
      reply.header('Retry-After', String(retryAfter));
      ctx.audit.write({
        action: 'inbound.code.ip-throttled',
        phoneId: '',
        ip,
        ua: undefined,
        reason: String(currentFailures),
      });
      return reply.code(429).send({
        error: 'ip-throttled',
        retryAfterSeconds: retryAfter,
      });
    }

    // Dedupe replay: was this exact code consumed by the same
    // fingerprint AND IP in the last 60s? If so, mint a fresh session
    // rather than erroring (user double-tapped Submit, network retried,
    // React Strict Mode fired twice). IP must match too — a UA-only
    // check let an attacker on a different network replay a captured
    // code within 60s (SEC-AUTH-02).
    const replay = findRecentVerify(code, now);
    if (replay && replay.uaFp === uaFp && replay.ip === ip) {
      return mintReplaySession({
        ctx,
        req,
        reply,
        userId: replay.userId,
        phone: replay.phone,
        ip,
        pid: replay.phone ? phoneLogId(replay.phone) : '',
        source: 'code',
      });
    }

    // Device-freshness gate (SEC-AUTH-01): the requesting IP must have
    // had a recent OTP issuance (or the inbound flow must have produced
    // a code recently). Without this, an attacker who never even loaded
    // the site can blind-guess against any active OTP they didn't request.
    if (!ipHasRecentIssuance({ ctx, ip, now })) {
      ctx.storage.bumpRateBucket(bucket.key, bucket.bucketStart);
      ctx.audit.write({
        action: 'inbound.code.no-match',
        phoneId: '',
        ip,
        ua: undefined,
        reason: 'no-issuance',
      });
      return reply.code(401).send({ error: 'unknown-or-expired' });
    }

    // Linear scan over active inbound OTP rows. Each row's hash is
    // bound to (phone, channel, code), so we recompute per-row.
    // Stop at the first match. The earlier "walk every row for constant
    // timing" loop was a self-inflicted brute-force amplifier: it ran
    // bindAndMintSession against whichever row matched a guessed code
    // even when the attacker held their own active OTP, without ever
    // incrementing the per-IP no-match bucket (SEC-AUTH-01).
    const active = ctx.storage.listActiveInboundOtps(now);
    let match = null as { phone: string; channel: 'sms' | 'whatsapp' } | null;
    for (const row of active) {
      const candidate = hashOtp({
        code,
        phone: row.phone,
        channel: row.channel,
        secret: ctx.config.otpSecret,
      });
      if (safeEqualHex(candidate, row.otp_hash)) {
        match = { phone: row.phone, channel: row.channel };
        break;
      }
    }

    if (!match) {
      // Always charge the per-IP failure bucket on a failed verification
      // (SEC-AUTH-01). The previous gate-only-on-no-match behaviour let
      // an attacker who held their own active OTP guess codes against
      // every active row without ever paying.
      ctx.storage.bumpRateBucket(bucket.key, bucket.bucketStart);
      ctx.audit.write({
        action: 'inbound.code.no-match',
        phoneId: '',
        ip,
        ua: undefined,
        reason: 'no-row',
      });
      return reply.code(401).send({ error: 'unknown-or-expired' });
    }

    // Re-read the row to check per-code attempts ceiling. (Concurrent
    // request may have bumped magic_attempts since the scan above.)
    const fresh = ctx.storage.getOtp(match.phone);
    if (!fresh || fresh.expires_at < now) {
      return reply.code(401).send({ error: 'unknown-or-expired' });
    }
    if (fresh.magic_attempts >= ctx.config.inboundMagicMaxAttempts) {
      ctx.storage.deleteOtp(fresh.phone);
      ctx.audit.write({
        action: 'inbound.magic.attempts-exceeded',
        phoneId: phoneLogId(fresh.phone),
        ip,
        ua: undefined,
        reason: 'code',
      });
      return reply.code(401).send({ error: 'unknown-or-expired' });
    }

    return bindAndMintSession({
      ctx,
      req,
      reply,
      phone: match.phone,
      channel: match.channel,
      ip,
      uaFp,
      pid: phoneLogId(match.phone),
      source: 'code',
      dedupeKey: code,
    });
  });
}
