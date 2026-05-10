/**
 * POST /v1/auth/dm-otp/verify
 *
 * Body: { code: string (6 digits), channel?: DmChannel }
 *
 * If `channel` is supplied, we additionally require the matched code's
 * channel to equal it (defence-in-depth so a code minted on WA can't be
 * silently accepted by the Telegram-flavoured UI). If absent, we accept
 * the code regardless of channel.
 *
 * Response 200:
 *   { ok: true, sessionJwt, userId, channel, externalId, expiresAt }
 *
 * Errors: 400 bad-body, 401 invalid-or-expired
 *
 * The user_id we emit is `dm:{channel}:{externalId}` — a deterministic
 * synthetic ID so this service is stateless. The downstream identity
 * service is expected to merge this into a canonical user record on
 * first verify (see apps/identity); that merge isn't this service's job.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DmOtpContext } from '../context.js';
import { OTP_LENGTH } from '../otp.js';
import { signSessionJwt, type DmChannel } from '../jwt.js';
import { makeVerifyEvent, maskExternalId } from '../audit.js';

const ChannelSchema = z.enum(['telegram', 'whatsapp', 'messenger', 'instagram']);

const BodySchema = z.object({
  code: z.string().length(OTP_LENGTH).regex(/^\d+$/),
  channel: ChannelSchema.optional(),
});

function userIdForChannel(channel: DmChannel, externalId: string): string {
  return `dm:${channel}:${externalId}`;
}

export async function registerVerify(
  app: FastifyInstance,
  ctx: DmOtpContext,
): Promise<void> {
  app.post('/v1/auth/dm-otp/verify', async (req, reply) => {
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad-body' });
    }
    const { code } = parsed.data;
    const expectedChannel = parsed.data.channel;

    const claimed = ctx.store.claim(code);
    if (!claimed) {
      ctx.audit.write(
        makeVerifyEvent({
          channel: expectedChannel ?? 'telegram',
          externalId: '',
          code,
          ok: false,
          reason: 'invalid-or-expired',
        }),
      );
      return reply.code(401).send({ error: 'invalid-or-expired' });
    }
    if (expectedChannel && claimed.channel !== expectedChannel) {
      ctx.audit.write(
        makeVerifyEvent({
          channel: claimed.channel,
          externalId: claimed.externalId,
          code,
          ok: false,
          reason: 'wrong-channel',
        }),
      );
      return reply.code(401).send({ error: 'invalid-or-expired' });
    }

    const userId = userIdForChannel(claimed.channel, claimed.externalId);
    const signed = await signSessionJwt({
      secret: ctx.config.jwtSecret,
      userId,
      channel: claimed.channel,
      externalId: claimed.externalId,
      phone: claimed.profile?.phone,
      ttlSeconds: ctx.config.sessionTtlSeconds,
    });

    ctx.audit.write(
      makeVerifyEvent({
        channel: claimed.channel,
        externalId: claimed.externalId,
        code,
        ok: true,
      }),
    );

    ctx.log.info(
      {
        channel: claimed.channel,
        externalIdMask: maskExternalId(claimed.externalId),
        jti: signed.jti,
      },
      'dm-otp: verified',
    );

    reply.header('Cache-Control', 'private, no-store');
    return reply.code(200).send({
      ok: true,
      sessionJwt: signed.jwt,
      userId,
      channel: claimed.channel,
      externalId: claimed.externalId,
      expiresAt: signed.expiresAt,
    });
  });
}
