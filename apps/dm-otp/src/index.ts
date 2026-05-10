/**
 * VTourn dm-otp service entrypoint.
 *
 * Boots Fastify on :3393. Wires four inbound webhooks (Telegram, Aiva
 * WhatsApp, Meta Messenger, Meta Instagram), the verify endpoint, and
 * the start-info endpoint that the website calls to render deep-links.
 *
 * Webhook signature verification runs at the route boundary BEFORE any
 * dispatch into the code generator. Failed signatures get a flat 401
 * with no audit row.
 *
 * Reply adapters default to the real HTTP fetch seam in production. Tests
 * inject capturing fakes via `buildServer({ ctx })`.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';

import { CodeStore } from './code-store.js';
import { JsonlAuditWriter } from './audit.js';
import {
  TelegramReply,
  WhatsAppReply,
  MessengerReply,
  InstagramReply,
} from './lib/replies/index.js';
import type { ReplyAdapter } from './lib/replies/types.js';
import { registerTelegramWebhook } from './routes/webhook-telegram.js';
import { registerWhatsAppWebhook } from './routes/webhook-whatsapp.js';
import {
  registerMessengerWebhook,
  registerInstagramWebhook,
} from './routes/webhook-meta.js';
import { registerVerify } from './routes/verify.js';
import { registerStartInfo } from './routes/start-info.js';
import type { DmOtpContext } from './context.js';

const PORT = Number(process.env.DM_OTP_PORT ?? 3393);
const BIND = process.env.DM_OTP_BIND ?? '0.0.0.0';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

const corsOrigins = (
  process.env.DM_OTP_CORS_ORIGINS ??
  'https://vtourn.com,https://vtorn.aiva.nz,http://localhost:3300'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function envOrDevDefault(key: string, prefix: string): string {
  const v = process.env[key];
  if (v && v.length >= 32) return v;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `${key} is required in production and must be at least 32 chars`,
    );
  }
  return `${prefix}-INSECURE-DEV-ONLY-DO-NOT-USE-IN-PROD-${'x'.repeat(16)}`;
}

export interface BuildOptions {
  ctx?: DmOtpContext;
}

export async function buildServer(
  opts: BuildOptions = {},
): Promise<FastifyInstance> {
  const usePretty =
    process.env.NODE_ENV !== 'production' &&
    process.env.NODE_ENV !== 'test' &&
    process.env.DM_OTP_PRETTY_LOGS !== 'false';

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

  // Capture the raw JSON body for HMAC verification. Fastify's default
  // JSON parser drops the raw bytes, so we install a small wrapper that
  // attaches `req.rawBody` before parsing. Required for Aiva + Meta.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      (req as unknown as { rawBody: string }).rawBody = body as string;
      try {
        const json = body ? JSON.parse(body as string) : {};
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  const ctx = opts.ctx ?? buildDefaultContext(app);

  app.get('/', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return {
      service: 'vtourn-dm-otp',
      version: '0.1.0',
      health: '/health',
    };
  });

  app.get('/health', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { status: 'ok', ts: new Date().toISOString() };
  });
  app.get('/healthz', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { status: 'ok', ts: new Date().toISOString() };
  });

  await registerTelegramWebhook(app, ctx);
  await registerWhatsAppWebhook(app, ctx);
  await registerMessengerWebhook(app, ctx);
  await registerInstagramWebhook(app, ctx);
  await registerVerify(app, ctx);
  await registerStartInfo(app, ctx);

  return app;
}

function buildDefaultContext(app: FastifyInstance): DmOtpContext {
  const productName = process.env.DM_OTP_PRODUCT_NAME ?? 'VTourn';

  // Code store. TODO(redis): persist across instances; today this is
  // single-instance only.
  const ttlMs = Number(process.env.DM_OTP_TTL_MS ?? 5 * 60 * 1000);
  const store = new CodeStore({ ttlMs });

  // Audit writer.
  const auditPath = process.env.DM_OTP_AUDIT_PATH ?? './data/dm-otp-issued.jsonl';
  const audit = new JsonlAuditWriter({
    path: auditPath,
    onError: (err) =>
      app.log.warn({ err: String(err) }, 'dm-otp: audit write failed'),
  });

  // Reply adapters. Each is constructed lazily so a missing single-channel
  // env var doesn't take the whole service down. We instead hand back a
  // stub that errors on send, so the matching webhook still authenticates
  // its signature but yields a `send-failed` audit row.
  const replies = {
    telegram: makeTelegramReply(app),
    whatsapp: makeWhatsAppReply(app),
    messenger: makeMessengerReply(app),
    instagram: makeInstagramReply(app),
  };

  return {
    store,
    replies,
    audit,
    config: {
      jwtSecret: envOrDevDefault('DM_OTP_JWT_SECRET', 'dm-otp-jwt'),
      telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
      aivaWebhookSecret: process.env.AIVA_WEBHOOK_SECRET ?? '',
      metaAppSecret: process.env.META_APP_SECRET ?? '',
      metaVerifyToken: process.env.META_VERIFY_TOKEN ?? '',
      telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME ?? '',
      aivaWaPhone: process.env.AIVA_WA_PHONE ?? '',
      facebookPageUsername: process.env.FACEBOOK_PAGE_USERNAME ?? '',
      instagramBusinessUsername: process.env.IG_BUSINESS_USERNAME ?? '',
      sessionTtlSeconds: Number(
        process.env.DM_OTP_SESSION_TTL_SECONDS ?? 30 * 24 * 60 * 60,
      ),
      productName,
    },
    now: () => Date.now(),
    log: {
      info: (obj, msg) => app.log.info(obj as object, msg),
      warn: (obj, msg) => app.log.warn(obj as object, msg),
      error: (obj, msg) => app.log.error(obj as object, msg),
    },
  };
}

class StubReply implements ReplyAdapter {
  channel:
    | 'telegram'
    | 'whatsapp'
    | 'messenger'
    | 'instagram';
  private readonly reason: string;
  constructor(
    channel: 'telegram' | 'whatsapp' | 'messenger' | 'instagram',
    reason: string,
  ) {
    this.channel = channel;
    this.reason = reason;
  }
  async reply(): Promise<{ ok: false; errorCode: string; errorMessage: string }> {
    return {
      ok: false,
      errorCode: 'not-configured',
      errorMessage: this.reason,
    };
  }
}

function makeTelegramReply(app: FastifyInstance): ReplyAdapter {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  if (!token) {
    app.log.warn(
      'dm-otp: TELEGRAM_BOT_TOKEN not set; telegram replies will fail',
    );
    return new StubReply('telegram', 'TELEGRAM_BOT_TOKEN not set');
  }
  return new TelegramReply({ botToken: token });
}

function makeWhatsAppReply(app: FastifyInstance): ReplyAdapter {
  const apiKey = process.env.AIVA_SMS_API_KEY ?? '';
  const sessionId = process.env.AIVA_WA_SESSION_ID ?? '';
  const baseUrl =
    process.env.AIVA_SMS_API_URL ??
    process.env.AIVA_SMS_URL ??
    'http://localhost:9252';
  if (!apiKey || !sessionId) {
    app.log.warn(
      'dm-otp: AIVA_SMS_API_KEY / AIVA_WA_SESSION_ID not set; whatsapp replies will fail',
    );
    return new StubReply('whatsapp', 'aiva-wa not configured');
  }
  return new WhatsAppReply({ baseUrl, apiKey, sessionId });
}

function makeMessengerReply(app: FastifyInstance): ReplyAdapter {
  const token = process.env.META_PAGE_ACCESS_TOKEN ?? '';
  if (!token) {
    app.log.warn(
      'dm-otp: META_PAGE_ACCESS_TOKEN not set; messenger replies will fail',
    );
    return new StubReply('messenger', 'META_PAGE_ACCESS_TOKEN not set');
  }
  return new MessengerReply({ pageAccessToken: token });
}

function makeInstagramReply(app: FastifyInstance): ReplyAdapter {
  // Instagram messages are sent against the same Page Access Token (the
  // IG account is linked to a Facebook Page). Allow a separate IG token
  // env var if Tim wants to scope it explicitly.
  const token =
    process.env.IG_PAGE_ACCESS_TOKEN ?? process.env.META_PAGE_ACCESS_TOKEN ?? '';
  if (!token) {
    app.log.warn(
      'dm-otp: IG / META access token not set; instagram replies will fail',
    );
    return new StubReply('instagram', 'IG access token not set');
  }
  return new InstagramReply({ pageAccessToken: token });
}

async function start() {
  const app = await buildServer();
  try {
    await app.listen({ port: PORT, host: BIND });
    app.log.info(
      { port: PORT, bind: BIND, corsOrigins },
      `vtourn-dm-otp listening on http://${BIND}:${PORT}`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
