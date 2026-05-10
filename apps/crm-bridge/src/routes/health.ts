import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

const SERVICE_NAME = '@vtorn/crm-bridge';
const VERSION = '0.1.0';

export async function registerHealth(app: FastifyInstance, ctx: AppContext) {
  app.get('/healthz', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return {
      ok: true,
      service: SERVICE_NAME,
      version: VERSION,
      events_total: ctx.store.totalEvents(),
      users_total: ctx.store.totalUsers(),
      ts: new Date().toISOString(),
    };
  });

  // Some monitors hit `/health`; alias to keep them happy.
  app.get('/health', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { status: 'ok', ts: new Date().toISOString() };
  });

  app.get('/version', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { service: SERVICE_NAME, version: VERSION };
  });

  app.get('/', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return {
      service: SERVICE_NAME,
      version: VERSION,
      health: '/healthz',
      docs: 'docs/25-keys-and-secrets-required.md',
    };
  });
}
