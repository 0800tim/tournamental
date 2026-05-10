/**
 * VTourn CRM bridge service entrypoint.
 *
 * Boots a Fastify HTTP server on :3395 with the event ingest endpoints,
 * the customer-360 aggregate endpoint, and a JSONL-backed mock GHL
 * client. The mock is a stand-in until we wire the real GoHighLevel API
 * (env vars listed below; see docs/25-keys-and-secrets-required.md).
 *
 * Env vars (see .env.example):
 *   CRM_PORT                 default 3395
 *   CRM_BIND                 default 0.0.0.0
 *   CRM_GHL_LOG_PATH         default ./data/ghl-calls.jsonl
 *   CRM_CORS_ORIGINS         csv of allowed origins
 *   GHL_LOCATION_ID          GoHighLevel location id (TODO: real client)
 *   GHL_API_KEY              GoHighLevel API key  (TODO: real client)
 *   LOG_LEVEL                default 'info'
 *   LOG_PRETTY               '1' for pino-pretty in dev
 *   NODE_ENV                 'production' triggers strict env checks
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';

import type { AppContext } from './context.js';
import { EventStore } from './store.js';
import { MockGhlClient, type GhlClient } from './lib/ghl-client.js';
import { registerHealth } from './routes/health.js';
import { registerEvents } from './routes/events.js';
import { registerCustomer } from './routes/customer.js';

const PORT = Number(process.env.CRM_PORT ?? 3395);
const BIND = process.env.CRM_BIND ?? '0.0.0.0';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

const corsOrigins = (
  process.env.CRM_CORS_ORIGINS ??
  'https://vtourn.com,https://app.vtourn.com,https://admin.vtourn.com,https://vtorn.aiva.nz,https://vtorn-crm.aiva.nz,http://localhost:3300'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function defaultGhlLogPath(): string {
  // Resolve next to the source / dist tree → `data/ghl-calls.jsonl`.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'data', 'ghl-calls.jsonl');
}

export interface BuildOptions {
  /** Override the GHL JSONL log path. Pass null to disable filesystem writes (tests). */
  ghlLogPath?: string | null;
  /** Inject a clock (unix seconds). Defaults to wall clock. */
  now?: () => number;
  /** Inject a custom GHL client (e.g. an in-memory mock for tests). */
  ghlClient?: GhlClient;
  /** Override the Fastify logger config. Pass `false` to silence in tests. */
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
    // Cloudflare fronts everything; HSTS handled at the edge.
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

  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const store = new EventStore();
  const ghl: GhlClient =
    opts.ghlClient ??
    new MockGhlClient({
      jsonlPath:
        opts.ghlLogPath !== undefined
          ? opts.ghlLogPath
          : process.env.CRM_GHL_LOG_PATH ?? defaultGhlLogPath(),
      now,
    });

  const ctx: AppContext = { store, ghl, now };

  await registerHealth(app, ctx);
  await registerEvents(app, ctx);
  await registerCustomer(app, ctx);

  return { app, ctx };
}

async function start() {
  const { app } = await buildServer();
  try {
    await app.listen({ port: PORT, host: BIND });
    app.log.info(
      {
        port: PORT,
        bind: BIND,
        corsOrigins,
        ghlLogPath: process.env.CRM_GHL_LOG_PATH ?? defaultGhlLogPath(),
      },
      `vtorn-crm-bridge listening on http://${BIND}:${PORT}`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
