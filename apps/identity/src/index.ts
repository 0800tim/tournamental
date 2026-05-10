/**
 * VTourn identity service entrypoint.
 *
 * Boots a Fastify HTTP server on :3392 with:
 *   POST /v1/links/start
 *   POST /v1/links/callback
 *   GET  /v1/users/:userId/links
 *   GET  /v1/users/:userId/humanness
 *   POST /v1/users/:userId/recompute   (admin)
 *   GET  /healthz
 *   GET  /v1/version
 *
 * v0.1 stubs every provider OAuth flow — see docs/20-identity-humanness-bots.md
 * for the design and lib/providers/*.ts for the env vars each provider needs
 * once Tim provisions real credentials.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';

import { Storage } from './lib/storage.js';
import type { IdentityContext } from './context.js';
import { registerLinks } from './routes/links.js';
import { registerHumanness } from './routes/humanness.js';

const PACKAGE_VERSION = '0.1.0';

const PORT = Number(process.env.IDENTITY_PORT ?? 3392);
const BIND = process.env.IDENTITY_BIND ?? '0.0.0.0';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

const corsOrigins = (
  process.env.IDENTITY_CORS_ORIGINS ??
  'https://vtourn.com,https://vtorn.aiva.nz,https://vtorn-admin.aiva.nz,http://localhost:3300,http://localhost:3340'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export interface BuildOptions {
  ctx?: IdentityContext;
}

export async function buildServer(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const usePretty =
    process.env.NODE_ENV !== 'production' &&
    process.env.NODE_ENV !== 'test' &&
    process.env.IDENTITY_PRETTY_LOGS !== 'false';

  const app = Fastify({
    logger: {
      level: LOG_LEVEL,
      transport: usePretty ? { target: 'pino-pretty' } : undefined,
    },
    disableRequestLogging: process.env.NODE_ENV !== 'production',
    trustProxy: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      cb(null, corsOrigins.includes(origin));
    },
    credentials: true,
  });

  await app.register(sensible);

  const ctx = opts.ctx ?? buildDefaultContext(app);

  app.get('/', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return {
      service: 'vtourn-identity',
      version: PACKAGE_VERSION,
      health: '/healthz',
    };
  });

  app.get('/healthz', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { status: 'ok', ts: new Date().toISOString() };
  });

  app.get('/v1/version', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return { service: 'vtourn-identity', version: PACKAGE_VERSION };
  });

  await registerLinks(app, ctx);
  await registerHumanness(app, ctx);

  return app;
}

function buildDefaultContext(app: FastifyInstance): IdentityContext {
  const linksPath = process.env.IDENTITY_LINKS_PATH ?? './data/identity-links.jsonl';
  const scoresPath = process.env.IDENTITY_SCORES_PATH ?? './data/humanness-scores.jsonl';

  const storage = new Storage({ linksPath, scoresPath });

  return {
    storage,
    config: {
      publicBaseUrl: process.env.IDENTITY_PUBLIC_BASE_URL ?? 'http://localhost:3392',
      adminToken: process.env.IDENTITY_ADMIN_TOKEN ?? '',
    },
    now: () => Date.now(),
    log: {
      info: (obj, msg) => app.log.info(obj as object, msg),
      warn: (obj, msg) => app.log.warn(obj as object, msg),
      error: (obj, msg) => app.log.error(obj as object, msg),
    },
  };
}

async function start(): Promise<void> {
  const app = await buildServer();
  try {
    await app.listen({ port: PORT, host: BIND });
    app.log.info(
      { port: PORT, bind: BIND, corsOrigins },
      `vtourn-identity listening on http://${BIND}:${PORT}`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
