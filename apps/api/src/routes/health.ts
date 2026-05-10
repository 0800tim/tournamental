import type { FastifyInstance } from 'fastify';

export async function registerHealth(app: FastifyInstance) {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness probe',
        description:
          'Always returns 200 with the current server timestamp. Cache-Control: no-store.',
        response: {
          200: {
            type: 'object',
            required: ['status', 'ts'],
            properties: {
              status: { type: 'string', enum: ['ok'] },
              ts: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return { status: 'ok', ts: new Date().toISOString() };
    },
  );
}
