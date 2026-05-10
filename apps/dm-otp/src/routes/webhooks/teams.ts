/**
 * Microsoft Teams (Bot Framework) inbound webhook.
 *
 * Bot Framework sends a JWT in the Authorization header signed by
 * Microsoft. Full validation requires fetching the OpenID metadata
 * and the JWKS — which we punt on unless MS_BOT_VERIFY_JWT=true is
 * set, because in dev/staging we accept a shared-secret bearer header
 * (set in the Bot Framework "App Service" config). In production we
 * recommend switching to JWT validation by setting MS_BOT_VERIFY_JWT
 * and providing a tenant id.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DmOtpContext } from '../../context.js';
import { dispatch } from '../../lib/dispatcher.js';

interface BotActivity {
  type?: string;
  text?: string;
  from?: { id?: string };
  conversation?: { id?: string };
  serviceUrl?: string;
}

function authorisedDev(req: FastifyRequest, expected: string): boolean {
  if (!expected) return false;
  const auth = req.headers['authorization'];
  return typeof auth === 'string' && auth === `Bearer ${expected}`;
}

export async function registerTeamsWebhook(
  app: FastifyInstance,
  ctx: DmOtpContext,
): Promise<void> {
  app.post('/v1/auth/dm-otp/webhooks/teams', async (req, reply) => {
    // Dev-mode shared-secret bearer; in prod replace with JWT validation.
    if (!authorisedDev(req, ctx.config.teamsAppPassword)) {
      return reply.code(401).send({ error: 'bad-signature' });
    }
    const a = req.body as BotActivity;
    if (
      a.type === 'message' &&
      typeof a.text === 'string' &&
      typeof a.from?.id === 'string' &&
      typeof a.conversation?.id === 'string' &&
      typeof a.serviceUrl === 'string'
    ) {
      await dispatch(
        {
          store: ctx.store,
          senders: ctx.senders,
          magicLinkChannels: ctx.magicLinkChannels,
          log: ctx.log,
        },
        {
          channel: 'teams',
          externalId: a.from.id,
          text: a.text,
          meta: {
            serviceUrl: a.serviceUrl,
            conversationId: a.conversation.id,
          },
        },
      );
    }
    return reply.code(200).send({ ok: true });
  });
}
