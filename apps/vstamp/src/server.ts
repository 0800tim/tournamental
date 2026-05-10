import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';

import { openDb } from './lib/db.js';
import { loadOrCreateSigner } from './lib/key-store.js';
import { registerHealth } from './routes/health.js';
import { registerIssue } from './routes/issue.js';
import { registerFinalise } from './routes/finalise.js';
import { registerProof } from './routes/proof.js';
import { registerRootRoute } from './routes/root.js';
import { registerVerify } from './routes/verify.js';
import { registerSwagger } from './swagger.js';
import type { Context } from './context.js';

export interface BuildOptions {
  dbPath?: string;
  adminToken?: string;
  passphrase?: string;
  corsOrigins?: string[];
  logLevel?: string;
  pretty?: boolean;
}

export async function buildServer(opts: BuildOptions = {}) {
  const dbPath = opts.dbPath ?? process.env.VSTAMP_DB_PATH ?? './apps/vstamp/data/vstamp.db';
  const adminToken = opts.adminToken ?? process.env.VSTAMP_ADMIN_TOKEN ?? '';
  const passphrase =
    opts.passphrase ?? process.env.VSTAMP_KEY_PASSPHRASE ?? '';

  if (!passphrase) {
    throw new Error(
      'VSTAMP_KEY_PASSPHRASE is required to encrypt the signing key at rest. Generate one with `openssl rand -hex 32`.',
    );
  }

  const corsOrigins =
    opts.corsOrigins ??
    (process.env.VSTAMP_CORS_ORIGINS ?? 'https://vtorn.aiva.nz,http://localhost:3300')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const logLevel = opts.logLevel ?? process.env.LOG_LEVEL ?? 'info';
  const pretty = opts.pretty ?? process.env.LOG_PRETTY === '1';

  const db = openDb(dbPath);
  const signer = loadOrCreateSigner(db, passphrase);
  const ctx: Context = { db, signer, adminToken };

  const app = Fastify({
    logger: {
      level: logLevel,
      ...(pretty ? { transport: { target: 'pino-pretty' } } : {}),
    },
    disableRequestLogging: false,
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });

  app.addHook('onClose', async () => {
    db.close();
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

  await app.register(rateLimit, {
    max: 600,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1', '::1'],
  });

  await app.register(sensible);

  await registerSwagger(app);

  await registerHealth(app, ctx);
  await registerIssue(app, ctx);
  await registerFinalise(app, ctx);
  await registerProof(app, ctx);
  await registerRootRoute(app, ctx);
  await registerVerify(app);

  return app;
}

async function start() {
  const port = Number(process.env.VSTAMP_PORT ?? 3390);
  const bind = process.env.VSTAMP_BIND ?? '0.0.0.0';
  const app = await buildServer();
  try {
    await app.listen({ port, host: bind });
    app.log.info({ port, bind }, `vstamp listening on http://${bind}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void start();
}
