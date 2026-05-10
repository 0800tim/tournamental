/**
 * GET /v1/auth/dm-otp/channels
 *
 * Returns the full channel list with deep-links and statuses for the
 * website to render the dynamic login grid. Cached publicly for 60s.
 */

import type { FastifyInstance } from 'fastify';
import { listChannels, visibleChannels } from '../lib/channels.js';

export async function registerChannelsRoute(
  app: FastifyInstance,
): Promise<void> {
  app.get('/v1/auth/dm-otp/channels', async (req, reply) => {
    const includeAll =
      (req.query as { include?: string } | undefined)?.include === 'all';
    const channels = (includeAll ? listChannels() : visibleChannels()).map((c) => ({
      id: c.id,
      label: c.label,
      status: c.status,
      deepLink: c.resolvedDeepLink,
      prompt: c.prompt,
      delivery: c.delivery,
      note: c.note,
    }));
    reply.header('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300');
    return { channels };
  });

  // Compatibility alias used by the website (per task spec).
  app.get('/v1/auth/dm-otp/start-info', async (_req, reply) => {
    const channels = visibleChannels().map((c) => ({
      id: c.id,
      label: c.label,
      status: c.status,
      deepLink: c.resolvedDeepLink,
      prompt: c.prompt,
      delivery: c.delivery,
      note: c.note,
    }));
    reply.header('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300');
    return {
      productName: 'VTourn',
      phrase: 'log in',
      ttlSeconds: 300,
      channels,
    };
  });
}
