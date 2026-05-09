/**
 * GET /healthz
 *
 * Liveness + lightweight stat. Returns the count of leaves and the age of
 * the most recent finalised root. Intentionally short to keep the
 * monitoring surface flat.
 */

import type { FastifyInstance } from 'fastify';
import type { Context } from '../context.js';

export async function registerHealth(app: FastifyInstance, ctx: Context) {
  app.get('/healthz', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const treeCount = ctx.db.countLeaves();
    const latest = ctx.db.latestRootAt();
    const latestRootAgeSeconds = latest === null ? null : Math.floor((Date.now() - latest) / 1000);
    return {
      ok: true,
      service: '@vtorn/vstamp',
      tree_count: treeCount,
      latest_root_age_seconds: latestRootAgeSeconds,
      pubkey: ctx.signer.pubkeyHex,
    };
  });

  app.get('/', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return {
      service: '@vtorn/vstamp',
      health: '/healthz',
      endpoints: [
        'POST /v1/vstamp/issue',
        'POST /v1/vstamp/finalise/:tournament_id',
        'GET  /v1/vstamp/proof/:leaf_hash',
        'GET  /v1/vstamp/root/:tournament_id/:date',
        'POST /v1/vstamp/verify',
      ],
    };
  });
}
