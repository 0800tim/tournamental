/**
 * Mastodon inbound webhook.
 *
 * Mastodon doesn't ship a HMAC-signed webhook out of the box. The
 * recommended setup is a small worker subscribed to the streaming
 * notifications API that POSTs the parsed event into us. We verify a
 * shared bearer header (MASTODON_INBOUND_BEARER) here; the operator
 * configures the same value in their forwarder.
 */

import type { FastifyInstance } from 'fastify';
import type { DmOtpContext } from '../../context.js';
import { dispatch } from '../../lib/dispatcher.js';
import { verifyBearer } from '../../lib/signatures.js';

interface MastodonForward {
  fromHandle?: string; // e.g. "user@example.social"
  text?: string;
  visibility?: string;
}

export async function registerMastodonWebhook(
  app: FastifyInstance,
  ctx: DmOtpContext,
): Promise<void> {
  app.post('/v1/auth/dm-otp/webhooks/mastodon', async (req, reply) => {
    if (
      !verifyBearer(
        ctx.config.mastodonInboundBearer,
        typeof req.headers['authorization'] === 'string' ? req.headers['authorization'] : undefined,
      )
    ) {
      return reply.code(401).send({ error: 'bad-signature' });
    }
    const body = req.body as MastodonForward;
    if (
      typeof body.fromHandle === 'string' &&
      typeof body.text === 'string' &&
      body.visibility === 'direct'
    ) {
      await dispatch(
        {
          store: ctx.store,
          senders: ctx.senders,
          magicLinkChannels: ctx.magicLinkChannels,
          log: ctx.log,
        },
        { channel: 'mastodon', externalId: body.fromHandle, text: body.text },
      );
    }
    return reply.code(200).send({ ok: true });
  });
}
