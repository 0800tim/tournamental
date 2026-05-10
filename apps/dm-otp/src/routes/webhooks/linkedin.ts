/**
 * LinkedIn inbound webhook — partner-gated stub.
 *
 * Returns 503 unless LINKEDIN_ACCESS_TOKEN is configured. Once the
 * partner program lands, the verification path is HMAC-SHA256 over
 * the body with the LinkedIn webhook secret; we wire that up at the
 * same time as the access token.
 */

import type { FastifyInstance } from 'fastify';
import type { DmOtpContext } from '../../context.js';

export async function registerLinkedInWebhook(
  app: FastifyInstance,
  _ctx: DmOtpContext,
): Promise<void> {
  app.post('/v1/auth/dm-otp/webhooks/linkedin', async (_req, reply) => {
    if (!process.env.LINKEDIN_ACCESS_TOKEN) {
      return reply.code(503).send({
        error: 'channel-not-configured',
        message: 'LinkedIn DM channel is partner-gated and not yet enabled.',
      });
    }
    // When access lands, signature verification + dispatch goes here.
    return reply.code(501).send({ error: 'not-implemented' });
  });
}
