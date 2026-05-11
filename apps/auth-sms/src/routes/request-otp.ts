/**
 * POST /v1/auth/request , send a 6-digit OTP via SMS or WhatsApp.
 *
 * Request:
 *   { phone: string (E.164), channel: "sms" | "whatsapp" }
 *
 * Responses:
 *   200 { ok: true, channel, phoneMasked, expiresInSeconds }
 *   400 { error: "bad-phone" | "bad-channel" | "bad-body" }
 *   429 { error: "rate-limited", retryAfterSeconds, reason }
 *   502 { error: "send-failed", reason }
 *
 * Behaviour:
 *   - Normalise phone to E.164.
 *   - Apply per-phone cooldown + per-phone hourly cap + per-IP hourly cap.
 *   - Generate a fresh 6-digit OTP, hash with HMAC, store with TTL.
 *   - Dispatch via the configured sender. On send failure we DELETE
 *     the OTP row so the user can retry without waiting for expiry.
 *   - We never echo the OTP back to the client.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthContext } from '../context.js';
import { normalisePhone, maskPhone } from '../phone.js';
import { checkOtpRequestLimit } from '../rate-limit.js';
import {
  generateOtp,
  hashOtp,
  formatSmsBody,
  formatWhatsAppBody,
} from '../otp.js';
import { phoneLogId } from '../storage.js';
import { truncateUa } from '../audit.js';

const BodySchema = z.object({
  phone: z.string().min(1).max(32),
  channel: z.enum(['sms', 'whatsapp']),
});

function clientIp(req: FastifyRequest): string {
  // Fastify with trustProxy splits X-Forwarded-For; req.ip is the
  // nearest non-proxy. Fall back to a stable string so rate-limit keys
  // never explode into NaNs.
  return (req.ip || '').trim() || '0.0.0.0';
}

export async function registerRequestOtp(
  app: FastifyInstance,
  ctx: AuthContext,
): Promise<void> {
  app.post('/v1/auth/request', async (req, reply) => {
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad-body' });
    }
    const phone = normalisePhone(parsed.data.phone);
    if (!phone) {
      return reply.code(400).send({ error: 'bad-phone' });
    }
    const channel = parsed.data.channel;
    const now = Math.floor(ctx.now() / 1000);
    const ip = clientIp(req);
    const ua = truncateUa(
      typeof req.headers['user-agent'] === 'string'
        ? req.headers['user-agent']
        : undefined,
    );
    const pid = phoneLogId(phone);

    // Prune expired OTPs opportunistically.
    ctx.storage.pruneExpiredOtps(now);

    const limit = checkOtpRequestLimit({
      storage: ctx.storage,
      phone,
      ip,
      now,
    });
    if (!limit.ok) {
      reply.header('Retry-After', String(limit.retryAfterSeconds));
      ctx.audit.write({
        action: 'otp.send.rate-limited',
        phoneId: pid,
        channel,
        ip,
        ua,
        reason: limit.reason,
      });
      return reply.code(429).send({
        error: 'rate-limited',
        reason: limit.reason,
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    const code = generateOtp();
    const otpHash = hashOtp({
      code,
      phone,
      channel,
      secret: ctx.config.otpSecret,
    });
    const expiresAt = now + ctx.config.otpTtlSeconds;
    ctx.storage.upsertOtp({
      phone,
      otp_hash: otpHash,
      channel,
      attempts: 0,
      expires_at: expiresAt,
      created_at: now,
    });

    const body =
      channel === 'sms'
        ? formatSmsBody({
            code,
            appHost: ctx.config.appHost,
            productName: ctx.config.productName,
          })
        : formatWhatsAppBody({
            code,
            productName: ctx.config.productName,
          });

    const result =
      channel === 'sms'
        ? await ctx.smsSender.send({ to: phone, body })
        : await ctx.waSender.send({ to: phone, body });

    if (!result.ok) {
      // Roll back the OTP so the user can retry immediately.
      ctx.storage.deleteOtp(phone);
      ctx.log.warn(
        {
          phoneId: pid,
          channel,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
        },
        'auth: send failed',
      );
      ctx.audit.write({
        action: 'otp.send.fail',
        phoneId: pid,
        channel,
        ip,
        ua,
        reason: result.errorCode ?? 'unknown',
      });
      return reply.code(502).send({
        error: 'send-failed',
        reason: result.errorCode ?? 'unknown',
      });
    }

    ctx.log.info(
      { phoneId: pid, channel, expiresAt },
      'auth: otp sent',
    );
    ctx.audit.write({
      action: 'otp.send.ok',
      phoneId: pid,
      channel,
      ip,
      ua,
    });

    return reply.code(200).send({
      ok: true,
      channel,
      phoneMasked: maskPhone(phone),
      expiresInSeconds: ctx.config.otpTtlSeconds,
    });
  });
}
