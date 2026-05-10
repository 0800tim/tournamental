/**
 * VTourn Drips bridge service entrypoint.
 *
 * Boots a Fastify HTTP server on :3399 with the contributor registry,
 * the revenue-distribution lifecycle, and the (mock by default) Drips client.
 *
 * Env vars (see README):
 *   DRIPS_PORT                  default 3399
 *   DRIPS_BIND                  default 0.0.0.0
 *   DRIPS_DATA_DIR              override JSONL data directory
 *   DRIPS_ADMIN_SECRET          REQUIRED in prod; >= 32 chars
 *   DRIPS_BACKEND               'mock' (default) | 'real'
 *   DRIPS_RPC_URL               required when DRIPS_BACKEND=real
 *   DRIPS_ACCOUNT_ADDRESS       required when DRIPS_BACKEND=real
 *   DRIPS_PRIVATE_KEY           required when DRIPS_BACKEND=real (NEVER commit)
 *   DRIPS_DRIP_LIST_ID          required when DRIPS_BACKEND=real
 *   DRIPS_CORS_ORIGINS          csv of allowed origins
 *   LOG_LEVEL                   default 'info'
 *   LOG_PRETTY                  '1' for pino-pretty in dev
 *   NODE_ENV                    'production' triggers strict env checks
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';

import type { AppContext } from './context.js';
import { ContributorStore, DistributionStore } from './lib/contributors.js';
import { makeDripsClient, type DripsBackend, type DripsClient } from './lib/drips-client.js';
import { registerHealth } from './routes/health.js';
import { registerContributors } from './routes/contributors.js';
import { registerDistributions } from './routes/distributions.js';
import { registerSwagger } from './swagger.js';

const PORT = Number(process.env.DRIPS_PORT ?? 3399);
const BIND = process.env.DRIPS_BIND ?? '0.0.0.0';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

const corsOrigins = (
  process.env.DRIPS_CORS_ORIGINS ??
  'https://vtourn.com,https://app.vtourn.com,https://vtorn.aiva.nz,https://vtorn-drips.aiva.nz,http://localhost:3300'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function defaultDataDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'data');
}

function resolveAdminSecret(): string {
  const v = process.env.DRIPS_ADMIN_SECRET;
  if (v && v.length >= 32) return v;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DRIPS_ADMIN_SECRET is required in production and must be >= 32 chars');
  }
  // Dev-only insecure default — clearly marked.
  return 'dev-only-drips-admin-secret-please-change-32c';
}

export interface BuildOptions {
  /** Override JSONL data directory. Use ":memory:" to skip disk persistence. */
  dataDir?: string;
  /** Override the admin secret (tests). */
  adminSecret?: string;
  /** Override the Drips backend explicitly. */
  dripsBackend?: DripsBackend;
  /** Inject a Drips client directly (tests). */
  dripsClient?: DripsClient;
  /** Inject a clock — returns ISO timestamps. */
  nowIso?: () => string;
  /** Override the Fastify logger. Pass `false` to silence in tests. */
  logger?: boolean | Record<string, unknown>;
}

export async function buildServer(opts: BuildOptions = {}) {
  const usePretty = process.env.LOG_PRETTY === '1';
  const defaultLogger = {
    level: LOG_LEVEL,
    ...(usePretty ? { transport: { target: 'pino-pretty' } } : {}),
  };
  const app = Fastify({
    logger: opts.logger ?? defaultLogger,
    disableRequestLogging: false,
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

  await registerSwagger(app);

  const dataDir = opts.dataDir ?? defaultDataDir();
  const inMemory = dataDir === ':memory:';
  const contributors = new ContributorStore({
    path: inMemory ? ':memory:' : join(dataDir, 'contributors.jsonl'),
  });
  const distributions = new DistributionStore({
    path: inMemory ? ':memory:' : join(dataDir, 'distributions.jsonl'),
  });
  const drips =
    opts.dripsClient ?? makeDripsClient({ backend: opts.dripsBackend });

  const ctx: AppContext = {
    contributors,
    distributions,
    drips,
    adminSecret: opts.adminSecret ?? resolveAdminSecret(),
    nowIso: opts.nowIso ?? (() => new Date().toISOString()),
  };

  await registerHealth(app, ctx);
  await registerContributors(app, ctx);
  await registerDistributions(app, ctx);

  return { app, ctx };
}

async function start() {
  const { app, ctx } = await buildServer();
  try {
    await app.listen({ port: PORT, host: BIND });
    app.log.info(
      {
        port: PORT,
        bind: BIND,
        corsOrigins,
        contributors_loaded: ctx.contributors.count(),
        distributions_loaded: ctx.distributions.count(),
        drips_backend: ctx.drips.backend,
      },
      `vtorn-drips-bridge listening on http://${BIND}:${PORT}`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
