/**
 * vtorn-news-aggregator boot.
 *
 * Composition:
 *  - Fastify app with helmet + cors + sensible
 *  - In-memory NewsStore backed by data/news-cache.jsonl
 *  - SourceFetcher with per-source timeouts
 *  - Scheduler (default 10 min) that polls every enabled source
 *
 * Port defaults to 3402 (see docs/22-deployment-and-tunnels.md). The
 * service is read-mostly; a forced refresh is available via
 * POST /v1/admin/refresh with the NEWS_ADMIN_SECRET bearer token.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';

import { registerHealth } from './routes/health.js';
import { registerVersion } from './routes/version.js';
import { registerNews } from './routes/news.js';
import { registerSwagger } from './swagger.js';
import { NewsStore } from './lib/store.js';
import { SourceFetcher } from './lib/fetcher.js';
import { Scheduler } from './scheduler.js';
import { ALL_SOURCES } from './sources/index.js';

const PORT = Number(process.env.NEWS_AGG_PORT ?? 3402);
const BIND = process.env.NEWS_AGG_BIND ?? '0.0.0.0';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';
const REFRESH_MIN = Math.max(1, Number(process.env.NEWS_REFRESH_INTERVAL_MIN ?? 10));
const CACHE_PATH = process.env.NEWS_CACHE_PATH ?? 'data/news-cache.jsonl';
const RETENTION_DAYS = Number(process.env.NEWS_RETENTION_DAYS ?? 30);
const ADMIN_SECRET = process.env.NEWS_ADMIN_SECRET;

const corsOrigins = (
  process.env.NEWS_AGG_CORS_ORIGINS ??
  'https://vtorn-www.aiva.nz,https://vtorn.aiva.nz,https://vtourn.com,http://localhost:3300,http://localhost:3320'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export async function buildServer(options: {
  cachePath?: string;
  retentionDays?: number;
  refreshIntervalMs?: number;
  startScheduler?: boolean;
  adminSecret?: string;
} = {}): Promise<{
  app: ReturnType<typeof Fastify>;
  scheduler: Scheduler;
  store: NewsStore;
  fetcher: SourceFetcher;
}> {
  const usePretty = process.env.LOG_PRETTY === '1';
  const app = Fastify({
    logger: {
      level: LOG_LEVEL,
      ...(usePretty ? { transport: { target: 'pino-pretty' } } : {}),
    },
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
      cb(null, corsOrigins.includes(origin) || corsOrigins.includes('*'));
    },
    credentials: true,
  });

  await app.register(sensible);
  await registerSwagger(app);

  const store = new NewsStore({
    cachePath: options.cachePath ?? CACHE_PATH,
    retentionDays: options.retentionDays ?? RETENTION_DAYS,
  });
  await store.load().catch((err) => {
    app.log.warn({ err }, 'news store: load failed; starting empty');
  });
  app.log.info({ items: store.size() }, 'news store loaded');

  const fetcher = new SourceFetcher();
  for (const s of ALL_SOURCES) fetcher.registerHealth(s);

  const scheduler = new Scheduler({
    intervalMs: options.refreshIntervalMs ?? REFRESH_MIN * 60 * 1000,
    fetcher,
    store,
    logger: app.log,
  });

  await registerHealth(app);
  await registerVersion(app);
  await registerNews(app, {
    store,
    fetcher,
    scheduler,
    adminSecret: options.adminSecret ?? ADMIN_SECRET,
  });

  if (options.startScheduler !== false) {
    scheduler.start();
  }

  app.addHook('onClose', async () => {
    scheduler.stop();
  });

  return { app, scheduler, store, fetcher };
}

async function main() {
  const { app } = await buildServer();
  try {
    await app.listen({ port: PORT, host: BIND });
    app.log.info(
      { port: PORT, bind: BIND, refreshMin: REFRESH_MIN, cors: corsOrigins.length },
      `vtorn-news-aggregator listening on http://${BIND}:${PORT}`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
