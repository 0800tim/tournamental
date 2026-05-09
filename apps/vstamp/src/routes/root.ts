/**
 * GET /v1/vstamp/root/:tournament_id/:date
 *
 * Returns the signed Merkle root for a (tournament, day) pair. Public,
 * cacheable. Useful for clients displaying "this tournament's verifiable
 * day-N root is X" without needing to know any individual receipt.
 */

import type { FastifyInstance } from 'fastify';
import type { Context } from '../context.js';

export async function registerRootRoute(app: FastifyInstance, ctx: Context) {
  app.get<{ Params: { tournament_id: string; date: string } }>(
    '/v1/vstamp/root/:tournament_id/:date',
    async (req, reply) => {
      const { tournament_id, date } = req.params;
      if (!/^[\w-]{1,128}$/.test(tournament_id)) {
        reply.code(400);
        return { error: 'invalid_tournament_id' };
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        reply.code(400);
        return { error: 'invalid_date', message: 'expected YYYY-MM-DD (UTC)' };
      }

      const root = ctx.db.getRoot(tournament_id, date);
      if (!root) {
        reply.code(404);
        return { error: 'root_not_found', tournament_id, day_bucket: date };
      }

      reply.header(
        'Cache-Control',
        'public, max-age=60, s-maxage=86400, stale-while-revalidate=604800',
      );
      return {
        tournament_id,
        day_bucket: date,
        root_hash: root.root_hash,
        signature: root.sig,
        pubkey: root.pubkey,
        finalised_at: root.finalised_at,
        leaf_count: root.leaf_count,
      };
    },
  );
}
