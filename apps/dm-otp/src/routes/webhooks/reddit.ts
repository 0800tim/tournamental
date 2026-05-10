/**
 * Reddit inbound — poll-only.
 *
 * A small worker (cron / interval) polls /api/me/inbox and POSTs each
 * unread message into this endpoint. The forwarder shares a bearer
 * secret. For a self-contained run we also expose POST /poll which
 * triggers the in-process poller (used by tests and dev).
 */

import type { FastifyInstance } from 'fastify';
import type { DmOtpContext } from '../../context.js';
import { dispatch } from '../../lib/dispatcher.js';
import { verifyBearer } from '../../lib/signatures.js';

interface RedditForward {
  fromUsername?: string;
  text?: string;
}

export async function registerRedditWebhook(
  app: FastifyInstance,
  ctx: DmOtpContext,
): Promise<void> {
  app.post('/v1/auth/dm-otp/webhooks/reddit', async (req, reply) => {
    if (
      !verifyBearer(
        ctx.config.redditPollerBearer,
        typeof req.headers['authorization'] === 'string' ? req.headers['authorization'] : undefined,
      )
    ) {
      return reply.code(401).send({ error: 'bad-signature' });
    }
    const body = req.body as RedditForward;
    if (typeof body.fromUsername === 'string' && typeof body.text === 'string') {
      await dispatch(
        {
          store: ctx.store,
          senders: ctx.senders,
          magicLinkChannels: ctx.magicLinkChannels,
          log: ctx.log,
        },
        { channel: 'reddit', externalId: body.fromUsername, text: body.text },
      );
    }
    return reply.code(200).send({ ok: true });
  });
}
