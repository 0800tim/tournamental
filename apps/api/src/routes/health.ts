import type { FastifyInstance } from 'fastify';

export async function registerHealth(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { status: 'ok', ts: new Date().toISOString() };
  });
}
