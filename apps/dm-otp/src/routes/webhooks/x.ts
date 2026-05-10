/**
 * X (Twitter) Account Activity API inbound webhook.
 *
 * GET — CRC challenge; POST — direct_message_events. Pro tier required.
 */

import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DmOtpContext } from '../../context.js';
import { dispatch } from '../../lib/dispatcher.js';
import { verifyXSignature } from '../../lib/signatures.js';

function rawBodyOf(req: FastifyRequest): string {
  return ((req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {}));
}

interface XPayload {
  direct_message_events?: Array<{
    type?: string;
    message_create?: {
      sender_id?: string;
      message_data?: { text?: string };
    };
  }>;
  for_user_id?: string;
}

export async function registerXWebhook(
  app: FastifyInstance,
  ctx: DmOtpContext,
): Promise<void> {
  // CRC challenge.
  app.get('/v1/auth/dm-otp/webhooks/x', async (req, reply) => {
    const q = req.query as { crc_token?: string };
    if (!q.crc_token) return reply.code(400).send('missing-crc');
    const sig = createHmac('sha256', ctx.config.xConsumerSecret)
      .update(q.crc_token)
      .digest('base64');
    return reply.code(200).send({ response_token: `sha256=${sig}` });
  });

  app.post('/v1/auth/dm-otp/webhooks/x', async (req, reply) => {
    const sig = req.headers['x-twitter-webhooks-signature'];
    if (!verifyXSignature(ctx.config.xConsumerSecret, rawBodyOf(req), typeof sig === 'string' ? sig : undefined)) {
      return reply.code(401).send({ error: 'bad-signature' });
    }
    const body = req.body as XPayload;
    for (const ev of body.direct_message_events ?? []) {
      const senderId = ev.message_create?.sender_id;
      const text = ev.message_create?.message_data?.text;
      if (
        ev.type === 'message_create' &&
        typeof senderId === 'string' &&
        typeof text === 'string' &&
        // ignore echoes (sender = our own bot)
        senderId !== body.for_user_id
      ) {
        await dispatch(
          {
            store: ctx.store,
            senders: ctx.senders,
            magicLinkChannels: ctx.magicLinkChannels,
            log: ctx.log,
          },
          { channel: 'x', externalId: senderId, text },
        );
      }
    }
    return reply.code(200).send({ ok: true });
  });
}
