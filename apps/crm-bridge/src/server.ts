/**
 * Tournamental CRM bridge service entrypoint.
 *
 * Boots a Fastify HTTP server on :3395 with the event ingest endpoints,
 * the customer-360 aggregate endpoint, and either a JSONL-backed mock
 * GHL client or a real GoHighLevel HTTP client gated by `CRM_BACKEND`.
 *
 * Env vars (see .env.example):
 *   CRM_PORT                 default 3395
 *   CRM_BIND                 default 0.0.0.0
 *   CRM_BACKEND              'mock' (default) | 'real'
 *   CRM_GHL_LOG_PATH         default ./data/ghl-calls.jsonl  (mock)
 *   CRM_GHL_FAILED_LOG_PATH  default ./data/ghl-failed.jsonl (real)
 *   CRM_ADMIN_TOKEN          bearer token for /v1/admin/replay-failed
 *   CRM_CORS_ORIGINS         csv of allowed origins
 *   GHL_LOCATION_ID          GoHighLevel location id (real backend)
 *   GHL_API_KEY              GoHighLevel private-integration token (real)
 *   GHL_API_BASE_URL         override base URL (testing); default LeadConnector
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
import {
  MockGhlClient,
  RealGhlClient,
  type GhlClient,
} from './lib/ghl-client.js';
import { registerHealth } from './routes/health.js';
import { registerEvents } from './routes/events.js';
import { registerCustomer } from './routes/customer.js';
import { registerAdmin } from './routes/admin.js';
import { registerSwagger } from './swagger.js';

const PORT = Number(process.env.CRM_PORT ?? 3395);
const BIND = process.env.CRM_BIND ?? '0.0.0.0';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

const corsOrigins = (
  process.env.CRM_CORS_ORIGINS ??
  'https://tournamental.com,https://play.tournamental.com,https://admin.tournamental.com,https://vtorn.aiva.nz,https://vtorn-crm.aiva.nz,http://localhost:3300'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function dataPath(file: string): string {
  // Resolve next to the source / dist tree → `data/<file>`.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'data', file);
}

export type CrmBackend = 'mock' | 'real';

export interface BuildOptions {
  /** Override the GHL JSONL log path. Pass null to disable filesystem writes (tests). */
  ghlLogPath?: string | null;
  /** Override the failed-call log path (real backend). Pass null to disable. */
  ghlFailedLogPath?: string | null;
  /** Inject a clock (unix seconds). Defaults to wall clock. */
  now?: () => number;
  /** Inject a custom GHL client (e.g. an in-memory mock for tests). */
  ghlClient?: GhlClient;
  /** Override the Fastify logger config. Pass `false` to silence in tests. */
  logger?: boolean | Record<string, unknown>;
  /** Override `CRM_BACKEND` selection. */
  backend?: CrmBackend;
  /** Override `CRM_ADMIN_TOKEN`. */
  adminToken?: string | null;
}

/**
 * Resolve the configured backend. Throws on boot when `real` is selected
 * but the credentials envelope is incomplete — we never want to silently
 * degrade to the mock and lose customer events.
 */
function resolveBackend(opts: BuildOptions): {
  client: GhlClient;
  failedLogPath: string | null;
  backend: CrmBackend;
} {
  if (opts.ghlClient) {
    return {
      client: opts.ghlClient,
      failedLogPath: opts.ghlFailedLogPath ?? null,
      backend: 'mock',
    };
  }

  const backend: CrmBackend =
    opts.backend ?? ((process.env.CRM_BACKEND as CrmBackend) || 'mock');
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));

  if (backend === 'real') {
    const apiKey = process.env.GHL_API_KEY;
    const locationId = process.env.GHL_LOCATION_ID;
    if (!apiKey || !locationId) {
      throw new Error(
        'CRM_BACKEND=real requires GHL_API_KEY and GHL_LOCATION_ID; ' +
          'set them in the environment or switch CRM_BACKEND=mock.',
      );
    }
    const failedLogPath =
      opts.ghlFailedLogPath !== undefined
        ? opts.ghlFailedLogPath
        : process.env.CRM_GHL_FAILED_LOG_PATH ?? dataPath('ghl-failed.jsonl');
    const client = new RealGhlClient({
      apiKey,
      locationId,
      baseUrl: process.env.GHL_API_BASE_URL,
      failedLogPath,
      now,
    });
    return { client, failedLogPath, backend: 'real' };
  }

  // Mock backend.
  const jsonlPath =
    opts.ghlLogPath !== undefined
      ? opts.ghlLogPath
      : process.env.CRM_GHL_LOG_PATH ?? dataPath('ghl-calls.jsonl');
  const client = new MockGhlClient({ jsonlPath, now });
  return { client, failedLogPath: null, backend: 'mock' };
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

  await registerSwagger(app);

  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const store = new EventStore();
  const { client: ghl, failedLogPath, backend } = resolveBackend(opts);

  const ctx: AppContext = { store, ghl, now };

  await registerHealth(app, ctx);
  await registerEvents(app, ctx);
  await registerCustomer(app, ctx);
  await registerAdmin(app, ctx, {
    failedLogPath,
    adminToken:
      opts.adminToken !== undefined
        ? opts.adminToken
        : process.env.CRM_ADMIN_TOKEN ?? null,
  });

  return { app, ctx, backend };
}

async function start() {
  const { app, backend } = await buildServer();
  try {
    await app.listen({ port: PORT, host: BIND });
    app.log.info(
      {
        port: PORT,
        bind: BIND,
        backend,
        corsOrigins,
      },
      `vtorn-crm-bridge listening on http://${BIND}:${PORT} (backend=${backend})`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
