/**
 * Slack Events API inbound webhook.
 *
 * Verifies the V0 signature with the signing secret. Handles:
 *   - url_verification challenge
 *   - event_callback message events from DMs and app_mentions
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DmOtpContext } from '../../context.js';
import { dispatch } from '../../lib/dispatcher.js';
import { verifySlackSignature } from '../../lib/signatures.js';

function rawBodyOf(req: FastifyRequest): string {
  return ((req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {}));
}

interface SlackEnvelope {
  type?: string;
  challenge?: string;
  event?: {
    type?: string;
    user?: string;
    channel?: string;
    text?: string;
    bot_id?: string;
    subtype?: string;
  };
}

export async function registerSlackWebhook(
  app: FastifyInstance,
  ctx: DmOtpContext,
): Promise<void> {
  app.post('/v1/auth/dm-otp/webhooks/slack', async (req, reply) => {
    const ts = req.headers['x-slack-request-timestamp'];
    const sig = req.headers['x-slack-signature'];
    const ok = verifySlackSignature({
      signingSecret: ctx.config.slackSigningSecret,
      timestamp: typeof ts === 'string' ? ts : undefined,
      signature: typeof sig === 'string' ? sig : undefined,
      rawBody: rawBodyOf(req),
      now: Math.floor(ctx.now() / 1000),
    });
    if (!ok) return reply.code(401).send({ error: 'bad-signature' });

    const env = req.body as SlackEnvelope;

    if (env.type === 'url_verification') {
      return reply.code(200).send({ challenge: env.challenge ?? '' });
    }

    const ev = env.event;
    if (
      ev?.type === 'message' &&
      typeof ev.user === 'string' &&
      typeof ev.channel === 'string' &&
      typeof ev.text === 'string' &&
      !ev.bot_id &&
      !ev.subtype
    ) {
      await dispatch(
        {
          store: ctx.store,
          senders: ctx.senders,
          magicLinkChannels: ctx.magicLinkChannels,
          log: ctx.log,
        },
        {
          channel: 'slack',
          // Reply scope is the channel id (DM). We key on user so the
          // verify endpoint can use the user's "slack id" handle.
          externalId: ev.user,
          text: ev.text,
          meta: { channelId: ev.channel },
        },
      );
    }
    return reply.code(200).send({ ok: true });
  });
}
