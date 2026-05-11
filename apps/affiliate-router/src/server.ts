/**
 * Tournamental affiliate router service entrypoint.
 *
 * Boots a Fastify HTTP server on :3370 with the affiliate click resolver,
 * the per-country partner index, and the audit-log SQLite store.
 *
 * Env vars (see .env.example):
 *   AFFILIATE_PORT                   default 3370
 *   AFFILIATE_BIND                   default 0.0.0.0
 *   AFFILIATE_DB_PATH                default ./data/clicks.db
 *   AFFILIATE_PARTNERS_PATH          override partners.json location
 *   AFFILIATE_USER_HASH_SALT         REQUIRED in prod; >= 16 chars
 *   AFFILIATE_CORS_ORIGINS           csv of allowed origins
 *   AFFILIATE_RATE_LIMIT_MAX         default 30 (per IP per minute)
 *   AFFCODE_<PARTNER_ID_UPPER>       per-partner affiliate code overrides
 *   LOG_LEVEL                        default 'info'
 *   LOG_PRETTY                       '1' for pino-pretty in dev
 *   NODE_ENV                         'production' triggers strict env checks
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';

import type { AppContext } from './context.js';
import { buildRegistry, loadPartners } from './partners.js';
import { ClickStore } from './storage.js';
import { registerClick } from './routes/click.js';
import { registerPartners } from './routes/partners.js';
import { registerHealth } from './routes/health.js';
import { registerSwagger } from './swagger.js';

const PORT = Number(process.env.AFFILIATE_PORT ?? 3370);
const BIND = process.env.AFFILIATE_BIND ?? '0.0.0.0';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

const corsOrigins = (
  process.env.AFFILIATE_CORS_ORIGINS ??
  'https://tournamental.com,https://play.tournamental.com,https://play.tournamental.com,https://play.tournamental.com,https://aff.tournamental.com,http://localhost:3300'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const RATE_LIMIT_MAX = Number(process.env.AFFILIATE_RATE_LIMIT_MAX ?? 30);

function defaultDbPath(): string {
  // Resolve next to the source / dist tree → `data/clicks.db`.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'data', 'clicks.db');
}

function resolveUserHashSalt(): string {
  const v = process.env.AFFILIATE_USER_HASH_SALT;
  if (v && v.length >= 16) return v;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'AFFILIATE_USER_HASH_SALT is required in production and must be >= 16 chars',
    );
  }
  // Dev-only insecure default — clearly marked.
  return 'dev-only-affiliate-salt-please-change-in-prod';
}

export interface BuildOptions {
  /** Override DB path. ":memory:" for tests. */
  dbPath?: string;
  /** Override partners.json path. */
  partnersPath?: string;
  /** Inject a clock (unix seconds). Defaults to wall clock. */
  now?: () => number;
  /** Override the user-hash salt. */
  userHashSalt?: string;
  /** Skip rate-limit plugin (for tests). */
  disableRateLimit?: boolean;
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

  if (!opts.disableRateLimit) {
    await app.register(rateLimit, {
      max: RATE_LIMIT_MAX,
      timeWindow: '1 minute',
      // Don't allowlist anything — even localhost callers should respect the
      // cap so dev exercises the limiter the same way prod does. Tests opt out
      // via `disableRateLimit`.
      keyGenerator: (req) => {
        // Prefer Cloudflare-injected client IP; fall back to req.ip.
        const cf = req.headers['cf-connecting-ip'];
        const cfStr = Array.isArray(cf) ? cf[0] : cf;
        return cfStr ?? req.ip;
      },
    });
  }

  await app.register(sensible);

  await registerSwagger(app);

  const partners = loadPartners(opts.partnersPath);
  const registry = buildRegistry(partners);
  const store = new ClickStore({ path: opts.dbPath ?? defaultDbPath() });

  const ctx: AppContext = {
    registry,
    store,
    userHashSalt: opts.userHashSalt ?? resolveUserHashSalt(),
    now: opts.now ?? (() => Math.floor(Date.now() / 1000)),
  };

  await registerHealth(app, ctx);
  await registerPartners(app, ctx);
  await registerClick(app, ctx);

  app.addHook('onClose', async () => {
    store.close();
  });

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
        partners_loaded: ctx.registry.list().length,
        rate_limit_max: RATE_LIMIT_MAX,
      },
      `vtorn-affiliate-router listening on http://${BIND}:${PORT}`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
