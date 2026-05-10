/**
 * Signal inbound — poll forwarder.
 *
 * A worker (or cron) polls signal-cli's REST gateway and POSTs each
 * inbound message here. Bearer-protected.
 */

import type { FastifyInstance } from 'fastify';
import type { DmOtpContext } from '../../context.js';
import { dispatch } from '../../lib/dispatcher.js';
import { verifyBearer } from '../../lib/signatures.js';

interface SignalForward {
  fromNumber?: string;
  text?: string;
}

export async function registerSignalWebhook(
  app: FastifyInstance,
  ctx: DmOtpContext,
): Promise<void> {
  app.post('/v1/auth/dm-otp/webhooks/signal', async (req, reply) => {
    if (
      !verifyBearer(
        ctx.config.signalPollerBearer,
        typeof req.headers['authorization'] === 'string' ? req.headers['authorization'] : undefined,
      )
    ) {
      return reply.code(401).send({ error: 'bad-signature' });
    }
    const body = req.body as SignalForward;
    if (typeof body.fromNumber === 'string' && typeof body.text === 'string') {
      await dispatch(
        {
          store: ctx.store,
          senders: ctx.senders,
          magicLinkChannels: ctx.magicLinkChannels,
          log: ctx.log,
        },
        { channel: 'signal', externalId: body.fromNumber, text: body.text },
      );
    }
    return reply.code(200).send({ ok: true });
  });
}
