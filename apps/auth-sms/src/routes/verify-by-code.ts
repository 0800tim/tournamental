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

    // Linear scan over active inbound OTP rows. Each row's hash is
    // bound to (phone, channel, code), so we recompute per-row.
    // Constant-time compare per row so timing does not leak which
    // row matched (in practice the OTP set is tiny — 10s of rows —
    // so the overall verify time is bounded at ~ms regardless).
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
        // No `break` — we walk all rows so timing is constant
        // regardless of where the match sits. (Tiny perf cost; big
        // attacker-confusion win.)
      }
    }

    if (!match) {
      // Dedupe replay: was this exact code consumed by this same
      // fingerprint in the last 60s? If so, mint a fresh session
      // rather than erroring — the user double-tapped Submit, or the
      // network retried, or React fired the handler twice. Bumping
      // the IP-failure bucket here would also be wrong: the user is
      // legitimate, they just clicked twice.
      const replay = findRecentVerify(code, now);
      if (replay && replay.uaFp === uaFp) {
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
