import type { FastifyInstance } from 'fastify';

export async function registerHealth(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { status: 'ok', ts: new Date().toISOString() };
  });

  // Convenience alias — every other vtorn service uses /health, so we
  // expose both for symmetry.
  app.get('/health', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { status: 'ok', ts: new Date().toISOString() };
  });
}
