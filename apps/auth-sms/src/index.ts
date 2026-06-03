/**
 * Tournamental auth-sms service entrypoint.
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
import { registerTelegramLink } from './routes/telegram-link.js';
import { registerInternalLinkPhone } from './routes/internal-link-phone.js';
import { registerInboundLogin } from './routes/inbound-login.js';
import { registerMagicVerify } from './routes/magic-verify.js';
import { registerVerifyByCode } from './routes/verify-by-code.js';
import { registerEmailOtp } from './routes/email-otp.js';
import { registerPhoneLink } from './routes/phone-link.js';
import { registerInternalSend } from './routes/internal-send.js';
import { registerSwagger } from './swagger.js';
import type { AuthContext } from './context.js';
import { buildAuditLogger } from './audit.js';
import {
  SendGridClient,
  StubEmailSender,
  sendGridConfigFromEnv,
  type EmailSender,
} from './sendgrid.js';

const PORT = Number(process.env.AUTH_PORT ?? 3330);
const BIND = process.env.AUTH_BIND ?? '0.0.0.0';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

const corsOrigins = (
  process.env.AUTH_CORS_ORIGINS ??
  'https://tournamental.com,https://play.tournamental.com,https://auth.tournamental.com,http://localhost:3300'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Fail-loud env loader for required secrets. The service refuses to
 * start when the secret is missing, too short, or matches a known
 * placeholder pattern (`CHANGE_ME`, `INSECURE`, `replace-me`, etc.). All
 * production secrets MUST be routed through this — silently falling
 * back to dev defaults was the SEC-AUTH-04 / -10 / -15 finding.
 */
function envOrFail(key: string): string {
  const v = process.env[key];
  if (!v || v.length < 32) {
    throw new Error(
      `${key} is required and must be at least 32 chars; set in .env`,
    );
  }
  if (/CHANGE_?ME|INSECURE|REPLACE[_-]?ME|example|placeholder/i.test(v)) {
    throw new Error(
      `${key} looks like a placeholder ("${v.slice(0, 24)}…"); generate a real secret with \`openssl rand -hex 32\` and set it in .env`,
    );
  }
  return v;
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

  await registerSwagger(app);

  const ctx = opts.ctx ?? buildDefaultContext(app);

  app.get('/', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return {
      service: 'tournamental-auth-sms',
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
  await registerTelegramLink(app, ctx);
  await registerInternalLinkPhone(app, ctx);
  await registerInboundLogin(app, ctx);
  await registerMagicVerify(app, ctx);
  await registerVerifyByCode(app, ctx);
  await registerEmailOtp(app, ctx);
  await registerPhoneLink(app, ctx);
  await registerInternalSend(app, ctx);

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

  const audit = buildAuditLogger({
    path: process.env.AUDIT_LOG_PATH,
    warn: (msg) => app.log.warn(msg),
  });

  // Email sender. Real SendGrid client when SENDGRID_API_KEY is set,
  // stub-to-log otherwise so dev environments still hit the /email/*
  // routes successfully.
  let emailSender: EmailSender | null;
  try {
    emailSender = new SendGridClient(sendGridConfigFromEnv());
  } catch (err) {
    app.log.warn(
      { err: String(err) },
      'auth: SENDGRID not configured; using stub email sender (dev only)',
    );
    emailSender = new StubEmailSender((msg) => app.log.info(msg));
  }

  return {
    storage,
    smsSender,
    waSender,
    emailSender,
    audit,
    config: {
      // SEC-AUTH-04 / -10 / -15: every authentication secret is fail-loud
      // via envOrFail. Missing, too-short (<32 chars), or placeholder
      // values crash the service at startup instead of silently falling
      // back to a dev default. `AUTH_ADMIN_TOKEN` is optional (empty
      // string disables the pairing-qr endpoint) but if set it must
      // also be fail-loud.
      otpSecret: envOrFail('AUTH_OTP_SECRET'),
      jwtSecret: envOrFail('AUTH_JWT_SECRET'),
      appHost: process.env.AUTH_APP_HOST ?? 'tournamental.com',
      productName: process.env.AUTH_PRODUCT_NAME ?? 'Tournamental',
      adminToken: process.env.AUTH_ADMIN_TOKEN
        ? envOrFail('AUTH_ADMIN_TOKEN')
        : '',
      otpTtlSeconds: Number(process.env.AUTH_OTP_TTL_SECONDS ?? 600),
      maxVerifyAttempts: Number(
        process.env.AUTH_MAX_VERIFY_ATTEMPTS ?? 5,
      ),
      sessionTtlSeconds: Number(
        process.env.AUTH_SESSION_TTL_SECONDS ?? 30 * 24 * 60 * 60,
      ),
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
      telegramBotUsername:
        process.env.TELEGRAM_BOT_USERNAME ?? 'TournamentalBot',
      inboundLoginSecret: process.env.INBOUND_LOGIN_SECRET
        ? envOrFail('INBOUND_LOGIN_SECRET')
        : '',
      inboundMagicMaxAttempts: Number(
        process.env.INBOUND_MAGIC_MAX_ATTEMPTS ?? 5,
      ),
      inboundCodeIpFailureMax: Number(
        process.env.INBOUND_CODE_IP_FAILURE_MAX ?? 60,
      ),
      inboundCookieDomain:
        process.env.INBOUND_COOKIE_DOMAIN ?? '.tournamental.com',
      magicLinkBaseUrl:
        process.env.MAGIC_LINK_BASE_URL ?? 'https://play.tournamental.com/',
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
      `tournamental-auth-sms listening on http://${BIND}:${PORT}`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
