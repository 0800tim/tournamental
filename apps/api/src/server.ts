import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';

import { registerHealth } from './routes/health.js';
import { registerVersion } from './routes/version.js';
import { registerRoot } from './routes/root.js';

const PORT = Number(process.env.VTORN_API_PORT ?? 3310);
const BIND = process.env.VTORN_API_BIND ?? '0.0.0.0';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

const corsOrigins = (process.env.VTORN_API_CORS_ORIGINS ?? 'https://vtorn.aiva.nz,http://localhost:3300')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: LOG_LEVEL,
      transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
    },
    disableRequestLogging: false,
    trustProxy: true,
  });

  await app.register(helmet, {
    // Cloudflare fronts everything; HSTS is handled at the edge. Be minimal here.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // server-to-server, curl, etc.
      cb(null, corsOrigins.includes(origin));
    },
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1', '::1'],
  });

  await app.register(sensible);

  await registerRoot(app);
  await registerHealth(app);
  await registerVersion(app);

  return app;
}

async function start() {
  const app = await buildServer();
  try {
    await app.listen({ port: PORT, host: BIND });
    app.log.info(
      { port: PORT, bind: BIND, corsOrigins },
      `vtorn-api listening on http://${BIND}:${PORT}`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
