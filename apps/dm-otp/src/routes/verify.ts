/**
 * POST /v1/auth/dm-otp/verify
 * GET  /v1/auth/dm-otp/email/click?code=...
 *
 * Verifies the OTP / magic-link click-token, mints a session JWT, and
 * upserts an identity record.
 *
 * Brute-force protection is layered in front of `CodeStore.verify`:
 *
 *   1. Per-subject lockout , 5 failed verifies for the same
 *      (channel, externalId) inside a 15-minute window locks the
 *      subject for 1 hour, even across freshly issued OTPs.
 *   2. Per-IP throttle , 30 verify attempts per 5 minutes per IP
 *      catches an attacker who cycles externalIds from one source.
 *   3. The CodeStore's own per-record 5-attempt cap is the third
 *      ring; it still invalidates a single code on its own.
 *
 * The magic-link click endpoint shares the IP throttle (a flooded
 * email-click route is still abuse) but does NOT participate in the
 * subject lockout because the lookup is token-only.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DmOtpContext } from '../context.js';
import { signSession } from '../lib/jwt-issuer.js';
import { externalIdHash } from '../lib/log.js';

const VerifyBody = z.object({
  channel: z.string().min(1).max(32),
  externalId: z.string().min(1).max(256),
  code: z.string().min(4).max(64),
});

function clientIp(req: FastifyRequest): string {
  return (req.ip || '').trim() || '0.0.0.0';
}

export async function registerVerifyRoute(
  app: FastifyInstance,
  ctx: DmOtpContext,
): Promise<void> {
  app.post('/v1/auth/dm-otp/verify', async (req, reply) => {
    const parsed = VerifyBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad-body' });
    const { channel, externalId, code } = parsed.data;
    const ip = clientIp(req);

    // Layer 1: pre-check the subject lockout + IP throttle.
    const guard = ctx.bruteForce.check({ channel, externalId, ip });
    if (!guard.ok) {
      reply.header('Retry-After', String(guard.retryAfterSeconds));
      ctx.log.warn(
        {
          channel,
          extHash: externalIdHash(channel, externalId),
          reason: guard.reason,
          ip,
        },
        'dm-otp: verify blocked',
      );
      return reply.code(429).send({
        error: guard.reason,
        retryAfterSeconds: guard.retryAfterSeconds,
      });
    }

    // Layer 2: record the attempt against the IP bucket before any
    // crypto work; a flood of 401s still counts toward the cap.
    ctx.bruteForce.recordIpAttempt(ip);

    const result = ctx.store.verify({ channel, externalId, code });
    if (!result.ok) {
      const lock = ctx.bruteForce.recordSubjectFailure({ channel, externalId });
      const status =
        result.reason === 'too-many-attempts' || lock.locked ? 429 : 401;
      const error = lock.locked ? 'subject-locked' : result.reason;
      ctx.log.warn(
        {
          channel,
          extHash: externalIdHash(channel, externalId),
          reason: result.reason,
          locked: lock.locked,
          failures: lock.failuresInWindow,
          ip,
        },
        'dm-otp: verify failed',
      );
      return reply.code(status).send({ error });
    }
    // Success: wipe any lockout state for this subject.
    ctx.bruteForce.clearSubject({ channel, externalId });

    const now = Math.floor(ctx.now() / 1000);
    const identity = ctx.identityStore.upsert(channel, externalId, ctx.now());
    const signed = await signSession({
      secret: ctx.config.jwtSecret,
      userId: identity.userId,
      channel,
      externalId,
      ttlSeconds: ctx.config.sessionTtlSeconds,
    });
    ctx.log.info(
      {
        channel,
        extHash: externalIdHash(channel, externalId),
        userId: identity.userId,
      },
      'dm-otp: verify ok',
    );
    return reply.code(200).send({
      ok: true,
      jwt: signed.jwt,
      expiresAt: signed.expiresAt,
      issuedAt: now,
      user: { id: identity.userId, channel, externalId },
    });
  });

  /**
   * Email magic-link click. Single endpoint with a token-only lookup
   * (we don't ask the user for their email twice).
   */
  app.get('/v1/auth/dm-otp/email/click', async (req, reply) => {
    const ip = clientIp(req);
    const q = req.query as { code?: string };
    if (!q.code) return reply.code(400).send({ error: 'missing-code' });

    // IP throttle (no subject context for the token-only path).
    const guard = ctx.bruteForce.check({
      channel: 'email',
      externalId: '__token__',
      ip,
    });
    if (!guard.ok) {
      reply.header('Retry-After', String(guard.retryAfterSeconds));
      return reply.code(429).send({
        error: guard.reason,
        retryAfterSeconds: guard.retryAfterSeconds,
      });
    }
    ctx.bruteForce.recordIpAttempt(ip);

    const result = ctx.store.verifyByToken({ channel: 'email', code: q.code });
    if (!result.ok) {
      const status = result.reason === 'too-many-attempts' ? 429 : 401;
      return reply.code(status).send({ error: result.reason });
    }
    const identity = ctx.identityStore.upsert(
      'email',
      result.record.externalId,
      ctx.now(),
    );
    const signed = await signSession({
      secret: ctx.config.jwtSecret,
      userId: identity.userId,
      channel: 'email',
      externalId: result.record.externalId,
      ttlSeconds: ctx.config.sessionTtlSeconds,
    });
    ctx.log.info(
      {
        channel: 'email',
        extHash: externalIdHash('email', result.record.externalId),
        userId: identity.userId,
      },
      'dm-otp: email magic-link verify ok',
    );
    return reply.code(200).send({
      ok: true,
      jwt: signed.jwt,
      expiresAt: signed.expiresAt,
      user: { id: identity.userId, channel: 'email', externalId: result.record.externalId },
    });
  });
}
