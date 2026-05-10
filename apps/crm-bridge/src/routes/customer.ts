/**
 * GET /v1/customer/:userId — returns the customer-360 aggregate.
 *
 * This is the endpoint Tim's admin UI calls to render a single user's
 * VTourn lifecycle: the events we've received, plus the GHL contact state
 * we've (mock-)pushed. No PII obfuscation here — admin only; mounting
 * upstream tunnels is gated by docs/22.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AppContext } from '../context.js';
import { aggregateForUser, upsertFromAggregate } from '../aggregate.js';

const ParamsSchema = z.object({
  userId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_.\-:]+$/u, 'userId must be url-safe'),
});

export async function registerCustomer(app: FastifyInstance, ctx: AppContext) {
  app.get('/v1/customer/:userId', async (req, reply) => {
    const parsed = ParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      reply.code(400).header('Cache-Control', 'no-store');
      return {
        error: 'invalid_params',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      };
    }

    const { userId } = parsed.data;
    const events = ctx.store.eventsForUser(userId);

    if (events.length === 0) {
      reply.code(404).header('Cache-Control', 'no-store');
      return { error: 'user_not_found', userId };
    }

    const aggregate = aggregateForUser(userId, events);
    const wouldUpsert = upsertFromAggregate(aggregate);

    reply.header('Cache-Control', 'no-store');
    return {
      userId,
      events_total: events.length,
      events,
      contact: {
        // The contact we'd send to GHL right now if we recomputed and pushed.
        // Mirrors the upsert payload exactly so admin can diff it against
        // the live GHL UI when investigating sync issues.
        ...wouldUpsert,
        tags: aggregate.tags,
      },
    };
  });
}
