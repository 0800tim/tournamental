/**
 * LINE Messaging API inbound webhook.
 *
 * Signature: X-Line-Signature = base64(HMAC-SHA256(channelSecret, body)).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DmOtpContext } from '../../context.js';
import { dispatch } from '../../lib/dispatcher.js';
import { verifyLineSignature } from '../../lib/signatures.js';

function rawBodyOf(req: FastifyRequest): string {
  return ((req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {}));
}

interface LineEvent {
  type?: string;
  source?: { userId?: string };
  message?: { type?: string; text?: string };
}

export async function registerLineWebhook(
  app: FastifyInstance,
  ctx: DmOtpContext,
): Promise<void> {
  app.post('/v1/auth/dm-otp/webhooks/line', async (req, reply) => {
    const sig = req.headers['x-line-signature'];
    if (!verifyLineSignature(ctx.config.lineChannelSecret, rawBodyOf(req), typeof sig === 'string' ? sig : undefined)) {
      return reply.code(401).send({ error: 'bad-signature' });
    }
    const body = req.body as { events?: LineEvent[] };
    for (const ev of body.events ?? []) {
      if (ev.type === 'message' && ev.message?.type === 'text') {
        const userId = ev.source?.userId;
        const text = ev.message?.text;
        if (typeof userId === 'string' && typeof text === 'string') {
          await dispatch(
            {
              store: ctx.store,
              senders: ctx.senders,
              magicLinkChannels: ctx.magicLinkChannels,
              log: ctx.log,
            },
            { channel: 'line', externalId: userId, text },
          );
        }
      }
    }
    return reply.code(200).send({ ok: true });
  });
}
