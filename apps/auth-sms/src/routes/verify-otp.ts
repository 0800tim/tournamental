/**
 * POST /v1/auth/verify , verify a 6-digit OTP and mint a session JWT.
 *
 * Request:
 *   { phone: string (E.164), code: string (6 digits) }
 *
 * Responses:
 *   200 { ok: true, jwt, expiresAt, user: { id, phone, displayName?, country? } }
 *   400 { error: "bad-body" | "bad-phone" | "bad-code" }
 *   401 { error: "invalid-or-expired" }     // OTP not found / expired / mismatch
 *   429 { error: "too-many-attempts" | "phone-locked" | "ip-throttled",
 *         retryAfterSeconds? }
 *
 * Defence in depth for OTP brute force is layered here:
 *
 *   1. Pre-check the phone lockout + IP throttle (see `lockout.ts`).
 *   2. Decoy HMAC + constant-time compare when the phone is unknown,
 *      so verify timing does not leak whether a phone has been seen.
 *   3. The per-OTP attempt counter on the OTP row (existing).
 *   4. After 5 *consecutive* phone failures inside a 15-minute window,
 *      the phone is locked for 1 hour even if the attacker requests
 *      a fresh code.
 *   5. Per-IP 30 verifies / 5 minutes catches attackers cycling phones.
 *   6. Every outcome (success + every failure mode) is audit-logged
 *      with the phoneId hash, IP, UA, and reason.
 *
 * On successful verify the OTP row is consumed (deleted) regardless
 * of whether the user is new or returning, so the same code cannot be
 * replayed.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthContext } from '../context.js';
import { syncUserToHighLevel } from '../highlevel.js';
import { normalisePhone } from '../phone.js';
import { hashOtp, safeEqualHex, OTP_LENGTH } from '../otp.js';
import { phoneLogId } from '../storage.js';
import { signSessionJwt } from '../jwt.js';
import {
  checkVerifyAllowed,
  recordIpAttempt,
  recordPhoneFailure,
  clearPhoneFailures,
} from '../lockout.js';
import { truncateUa, type AuditAction } from '../audit.js';

const BodySchema = z.object({
  phone: z.string().min(1).max(32),
  code: z.string().length(OTP_LENGTH).regex(/^\d+$/),
});

/**
 * Stable dummy hash compared against when the phone is unknown. Same
 * hex length as a real HMAC-SHA-256 output so `timingSafeEqual` runs
 * the same byte-by-byte loop on either path.
 */
const DECOY_HASH = 'f'.repeat(64);

function clientIp(req: FastifyRequest): string {
  return (req.ip || '').trim() || '0.0.0.0';
}

export async function registerVerifyOtp(
  app: FastifyInstance,
  ctx: AuthContext,
): Promise<void> {
  app.post('/v1/auth/verify', async (req, reply) => {
    const ip = clientIp(req);
    const ua = truncateUa(
      typeof req.headers['user-agent'] === 'string'
        ? req.headers['user-agent']
        : undefined,
    );

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad-body' });
    }
    const phone = normalisePhone(parsed.data.phone);
    if (!phone) return reply.code(400).send({ error: 'bad-phone' });
    const code = parsed.data.code;
    const now = Math.floor(ctx.now() / 1000);
    const pid = phoneLogId(phone);

    const writeAudit = (action: AuditAction, reason?: string): void => {
      ctx.audit.write({ action, phoneId: pid, ip, ua, reason });
    };

    // Layer 1: phone lockout + per-IP throttle.
    const allowed = checkVerifyAllowed({ storage: ctx.storage, phone, ip, now });
    if (!allowed.ok) {
      reply.header('Retry-After', String(allowed.retryAfterSeconds));
      writeAudit(
        allowed.reason === 'phone-locked'
          ? 'otp.verify.locked-out'
          : 'otp.verify.rate-limited',
        allowed.reason,
      );
      return reply.code(429).send({
        error: allowed.reason,
        retryAfterSeconds: allowed.retryAfterSeconds,
      });
    }

    // Layer 2: count this verify against the IP bucket before doing any
    // crypto. We bump on every attempt so a flood of 401s is also caught.
    recordIpAttempt({ storage: ctx.storage, ip, now });

    const otp = ctx.storage.getOtp(phone);

    // Layer 3: constant-time decoy when the phone is unknown so timing
    // doesn't leak existence.
    if (!otp) {
      const candidate = hashOtp({
        code,
        phone,
        channel: 'sms',
        secret: ctx.config.otpSecret,
      });
      // Discard the result; we just paid the same CPU cost.
      void safeEqualHex(candidate, DECOY_HASH);
      writeAudit('otp.verify.unknown-phone');
      return reply.code(401).send({ error: 'invalid-or-expired' });
    }

    if (otp.expires_at < now) {
      ctx.storage.deleteOtp(phone);
      writeAudit('otp.verify.expired');
      return reply.code(401).send({ error: 'invalid-or-expired' });
    }
    if (otp.attempts >= ctx.config.maxVerifyAttempts) {
      ctx.storage.deleteOtp(phone);
      writeAudit('otp.verify.bad-code', 'attempts-exhausted');
      return reply.code(429).send({ error: 'too-many-attempts' });
    }

    const expectedHash = hashOtp({
      code,
      phone,
      channel: otp.channel,
      secret: ctx.config.otpSecret,
    });
    const match = safeEqualHex(expectedHash, otp.otp_hash);
    if (!match) {
      const newAttempts = ctx.storage.incrementOtpAttempts(phone);
      // Layer 4: phone-level lockout across OTP requests.
      const lock = recordPhoneFailure({
        storage: ctx.storage,
        phone,
        now,
      });
      if (newAttempts >= ctx.config.maxVerifyAttempts || lock.locked) {
        ctx.storage.deleteOtp(phone);
        writeAudit('otp.verify.bad-code', 'attempts-exhausted');
        return reply.code(429).send({ error: 'too-many-attempts' });
      }
      writeAudit('otp.verify.bad-code');
      return reply.code(401).send({ error: 'invalid-or-expired' });
    }

    // Match. OTP consumed; clear any lingering lockout state.
    ctx.storage.deleteOtp(phone);
    clearPhoneFailures({ storage: ctx.storage, phone });

    const user = ctx.storage.findOrCreateUser(phone, now);

    // Mirror the user into HighLevel as a `player` contact. Fire-and-forget:
    // never blocks the login response, never throws (see highlevel.ts).
    void syncUserToHighLevel(ctx.storage, user, { now, log: ctx.log });

    const signed = await signSessionJwt({
      secret: ctx.config.jwtSecret,
      userId: user.id,
      // SMS-OTP path always has a phone , but the column is nullable since
      // v0.2 (Telegram users may have no phone), so coerce defensively.
      phone: user.phone ?? phone,
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

    ctx.log.info(
      { phoneId: pid, userId: user.id, jti: signed.jti },
      'auth: verify ok',
    );
    writeAudit('otp.verify.ok');

    return reply.code(200).send({
      ok: true,
      jwt: signed.jwt,
      expiresAt: signed.expiresAt,
      user: {
        id: user.id,
        phone: user.phone,
        displayName: user.display_name,
        country: user.country,
      },
    });
  });
}
