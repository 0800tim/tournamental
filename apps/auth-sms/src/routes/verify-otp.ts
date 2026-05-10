/**
 * POST /v1/auth/verify — verify a 6-digit OTP and mint a session JWT.
 *
 * Request:
 *   { phone: string (E.164), code: string (6 digits) }
 *
 * Responses:
 *   200 { ok: true, jwt, expiresAt, user: { id, phone, displayName?, country? } }
 *   400 { error: "bad-body" | "bad-phone" | "bad-code" }
 *   401 { error: "invalid-or-expired" }     // OTP not found / expired / mismatch
 *   429 { error: "too-many-attempts" }      // 5 wrong codes used
 *
 * On successful verify the OTP row is consumed (deleted) regardless
 * of whether the user is new or returning, so the same code cannot be
 * replayed.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthContext } from '../context.js';
import { normalisePhone } from '../phone.js';
import { hashOtp, safeEqualHex, OTP_LENGTH } from '../otp.js';
import { phoneLogId } from '../storage.js';
import { signSessionJwt } from '../jwt.js';

const BodySchema = z.object({
  phone: z.string().min(1).max(32),
  code: z.string().length(OTP_LENGTH).regex(/^\d+$/),
});

export async function registerVerifyOtp(
  app: FastifyInstance,
  ctx: AuthContext,
): Promise<void> {
  app.post('/v1/auth/verify', async (req, reply) => {
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad-body' });
    }
    const phone = normalisePhone(parsed.data.phone);
    if (!phone) return reply.code(400).send({ error: 'bad-phone' });
    const code = parsed.data.code;
    const now = Math.floor(ctx.now() / 1000);

    const otp = ctx.storage.getOtp(phone);
    if (!otp) {
      // Don't disclose whether the phone has ever requested an OTP.
      return reply.code(401).send({ error: 'invalid-or-expired' });
    }
    if (otp.expires_at < now) {
      ctx.storage.deleteOtp(phone);
      return reply.code(401).send({ error: 'invalid-or-expired' });
    }
    if (otp.attempts >= ctx.config.maxVerifyAttempts) {
      ctx.storage.deleteOtp(phone);
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
      if (newAttempts >= ctx.config.maxVerifyAttempts) {
        ctx.storage.deleteOtp(phone);
        return reply.code(429).send({ error: 'too-many-attempts' });
      }
      return reply.code(401).send({ error: 'invalid-or-expired' });
    }

    // OTP consumed.
    ctx.storage.deleteOtp(phone);

    const user = ctx.storage.findOrCreateUser(phone, now);

    const signed = await signSessionJwt({
      secret: ctx.config.jwtSecret,
      userId: user.id,
      // SMS-OTP path always has a phone — but the column is nullable since
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
      { phoneId: phoneLogId(phone), userId: user.id, jti: signed.jti },
      'auth: verify ok',
    );

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
