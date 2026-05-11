import type { FastifyInstance } from 'fastify';

export async function registerRoot(app: FastifyInstance) {
  app.get('/', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return {
      service: 'vtorn-api',
      docs: 'https://github.com/0800tim/tournamental',
      health: '/health',
      version: '/v1/version',
    };
  });
}
