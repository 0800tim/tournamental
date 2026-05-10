/**
 * POST /v1/auth/dm-otp/verify
 * GET  /v1/auth/dm-otp/email/click?code=...
 *
 * Verifies the OTP / magic-link click-token, mints a session JWT, and
 * upserts an identity record.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DmOtpContext } from '../context.js';
import { signSession } from '../lib/jwt-issuer.js';
import { externalIdHash } from '../lib/log.js';

const VerifyBody = z.object({
  channel: z.string().min(1).max(32),
  externalId: z.string().min(1).max(256),
  code: z.string().min(4).max(64),
});

export async function registerVerifyRoute(
  app: FastifyInstance,
  ctx: DmOtpContext,
): Promise<void> {
  app.post('/v1/auth/dm-otp/verify', async (req, reply) => {
    const parsed = VerifyBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad-body' });
    const { channel, externalId, code } = parsed.data;

    const result = ctx.store.verify({ channel, externalId, code });
    if (!result.ok) {
      const status =
        result.reason === 'too-many-attempts' ? 429 : 401;
      return reply.code(status).send({ error: result.reason });
    }
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
    const q = req.query as { code?: string };
    if (!q.code) return reply.code(400).send({ error: 'missing-code' });
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
