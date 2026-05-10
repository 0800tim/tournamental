/**
 * Viber Bot API inbound webhook.
 *
 * Signature: X-Viber-Content-Signature = hex(HMAC-SHA256(authToken, body)).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DmOtpContext } from '../../context.js';
import { dispatch } from '../../lib/dispatcher.js';
import { verifyViberSignature } from '../../lib/signatures.js';

function rawBodyOf(req: FastifyRequest): string {
  return ((req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {}));
}

interface ViberCallback {
  event?: string;
  sender?: { id?: string };
  message?: { type?: string; text?: string };
}

export async function registerViberWebhook(
  app: FastifyInstance,
  ctx: DmOtpContext,
): Promise<void> {
  app.post('/v1/auth/dm-otp/webhooks/viber', async (req, reply) => {
    const sig = req.headers['x-viber-content-signature'];
    if (!verifyViberSignature(ctx.config.viberAuthToken, rawBodyOf(req), typeof sig === 'string' ? sig : undefined)) {
      return reply.code(401).send({ error: 'bad-signature' });
    }
    const body = req.body as ViberCallback;
    if (body.event === 'message' && body.message?.type === 'text') {
      const userId = body.sender?.id;
      const text = body.message?.text;
      if (typeof userId === 'string' && typeof text === 'string') {
        await dispatch(
          {
            store: ctx.store,
            senders: ctx.senders,
            magicLinkChannels: ctx.magicLinkChannels,
            log: ctx.log,
          },
          { channel: 'viber', externalId: userId, text },
        );
      }
    }
    return reply.code(200).send({ status: 0 });
  });
}
