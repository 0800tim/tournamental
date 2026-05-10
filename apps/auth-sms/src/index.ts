/**
 * VTourn auth-sms service entrypoint.
 *
 * Boots a Fastify HTTP server on :3330 with the OTP request/verify/session
 * endpoints. Defaults to the Aiva SMS gateway for both SMS and WhatsApp;
 * falls back to local Baileys for WhatsApp if WHATSAPP_TRANSPORT=baileys;
 * falls back to stub senders if no credentials are configured (dev only).
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';

import { Storage } from './storage.js';
import { AivaSmsClient, StubSmsClient, aivaSmsConfigFromEnv } from './sms-gateway.js';
import {
  AivaWhatsAppClient,
  LocalBaileysClient,
  StubWhatsAppClient,
  aivaWhatsAppConfigFromEnv,
  type WhatsAppSender,
} from './whatsapp-baileys.js';
import { registerRequestOtp } from './routes/request-otp.js';
import { registerVerifyOtp } from './routes/verify-otp.js';
import { registerSession } from './routes/session.js';
import { registerWhatsAppPairing } from './routes/whatsapp-pairing.js';
import { registerTelegramCallback } from './routes/telegram-callback.js';
import type { AuthContext } from './context.js';

const PORT = Number(process.env.AUTH_PORT ?? 3330);
const BIND = process.env.AUTH_BIND ?? '0.0.0.0';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

const corsOrigins = (
  process.env.AUTH_CORS_ORIGINS ??
  'https://vtourn.com,https://vtorn.aiva.nz,https://vtorn-auth.aiva.nz,http://localhost:3300'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function envOrFail(key: string): string {
  const v = process.env[key];
  if (!v || v.length < 32) {
    throw new Error(
      `${key} is required and must be at least 32 chars; set in .env`,
    );
  }
  return v;
}

function envOrDevDefault(key: string, prefix: string): string {
  const v = process.env[key];
  if (v && v.length >= 32) return v;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `${key} is required in production and must be at least 32 chars`,
    );
  }
  // Dev-only insecure default — clearly marked.
  return `${prefix}-INSECURE-DEV-ONLY-DO-NOT-USE-IN-PROD-${'x'.repeat(16)}`;
}

export interface BuildOptions {
  ctx?: AuthContext;
}

export async function buildServer(opts: BuildOptions = {}): Promise<FastifyInstance> {
  // pino-pretty is only used for local interactive dev; CI and tests run
  // with NODE_ENV=test and prod runs with NODE_ENV=production — both skip
  // it so the package isn't a runtime requirement.
  const usePretty =
    process.env.NODE_ENV !== 'production' &&
    process.env.NODE_ENV !== 'test' &&
    process.env.AUTH_PRETTY_LOGS !== 'false';

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
      service: 'vtourn-auth-sms',
      version: '0.1.0',
      health: '/health',
    };
  });

  app.get('/health', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { status: 'ok', ts: new Date().toISOString() };
  });

  await registerRequestOtp(app, ctx);
  await registerVerifyOtp(app, ctx);
  await registerSession(app, ctx);
  await registerWhatsAppPairing(app, ctx);
  await registerTelegramCallback(app, ctx);

  app.addHook('onClose', async () => {
    try {
      await ctx.waSender.shutdown();
    } catch {
      /* ignore */
    }
    try {
      ctx.storage.close();
    } catch {
      /* ignore */
    }
  });

  return app;
}

function buildDefaultContext(app: FastifyInstance): AuthContext {
  const dbPath = process.env.AUTH_DB_PATH ?? './data/auth.db';
  const storage = new Storage({ path: dbPath });

  // SMS sender.
  let smsSender: AivaSmsClient | StubSmsClient;
  try {
    smsSender = new AivaSmsClient(aivaSmsConfigFromEnv());
  } catch (err) {
    app.log.warn(
      { err: String(err) },
      'auth: AIVA_SMS not configured; using stub SMS sender (dev only)',
    );
    smsSender = new StubSmsClient((msg) => app.log.info(msg));
  }

  // WhatsApp sender.
  const transport = (process.env.WHATSAPP_TRANSPORT ?? 'aiva').toLowerCase();
  let waSender: WhatsAppSender;
  if (transport === 'baileys') {
    waSender = new LocalBaileysClient({
      authDir: process.env.BAILEYS_AUTH_DIR ?? './baileys-auth',
      qrPngPath:
        process.env.BAILEYS_QR_PATH ?? './baileys-auth/last-qr.png',
      log: (msg, meta) => app.log.info(meta ?? {}, msg),
    });
  } else {
    try {
      waSender = new AivaWhatsAppClient(aivaWhatsAppConfigFromEnv());
    } catch (err) {
      app.log.warn(
        { err: String(err) },
        'auth: AIVA_WA not configured; using stub WhatsApp sender (dev only)',
      );
      waSender = new StubWhatsAppClient((msg) => app.log.info(msg));
    }
  }

  return {
    storage,
    smsSender,
    waSender,
    config: {
      otpSecret: envOrDevDefault('AUTH_OTP_SECRET', 'otp'),
      jwtSecret: envOrDevDefault('AUTH_JWT_SECRET', 'jwt'),
      appHost: process.env.AUTH_APP_HOST ?? 'vtourn.com',
      productName: process.env.AUTH_PRODUCT_NAME ?? 'VTourn',
      adminToken: process.env.AUTH_ADMIN_TOKEN ?? '',
      otpTtlSeconds: Number(process.env.AUTH_OTP_TTL_SECONDS ?? 600),
      maxVerifyAttempts: Number(
        process.env.AUTH_MAX_VERIFY_ATTEMPTS ?? 5,
      ),
      sessionTtlSeconds: Number(
        process.env.AUTH_SESSION_TTL_SECONDS ?? 30 * 24 * 60 * 60,
      ),
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
      telegramBotUsername:
        process.env.TELEGRAM_BOT_USERNAME ?? 'VTournBot',
    },
    now: () => Date.now(),
    log: {
      info: (obj, msg) => app.log.info(obj as object, msg),
      warn: (obj, msg) => app.log.warn(obj as object, msg),
      error: (obj, msg) => app.log.error(obj as object, msg),
    },
  };
}

async function start() {
  const app = await buildServer();
  try {
    await app.listen({ port: PORT, host: BIND });
    app.log.info(
      { port: PORT, bind: BIND, corsOrigins },
      `vtourn-auth-sms listening on http://${BIND}:${PORT}`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}

// Reference unused symbol so linters don't flag it; CI also ensures
// envOrFail is wired into a future strict-prod path.
void envOrFail;
