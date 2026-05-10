import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

export const SERVICE_VERSION = '0.1.0';

export async function registerHealth(app: FastifyInstance, ctx: AppContext) {
  app.get('/healthz', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return {
      ok: true,
      service: '@vtorn/drips-bridge',
      contributors_loaded: ctx.contributors.count(),
      distributions_loaded: ctx.distributions.count(),
      drips_backend: ctx.drips.backend,
      ts: new Date().toISOString(),
    };
  });

  app.get('/v1/version', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return {
      service: '@vtorn/drips-bridge',
      version: SERVICE_VERSION,
      drips_backend: ctx.drips.backend,
    };
  });
}
