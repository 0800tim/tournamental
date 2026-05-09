import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

export async function registerHealth(app: FastifyInstance, ctx: AppContext) {
  app.get('/healthz', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return {
      ok: true,
      service: '@vtorn/affiliate-router',
      partners_loaded: ctx.registry.list().length,
      ts: new Date().toISOString(),
    };
  });
}
