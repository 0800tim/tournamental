/**
 * VTourn dm-otp service entrypoint.
 *
 * Boots a Fastify HTTP server on :3331 with:
 *   - Per-channel webhook receivers under /v1/auth/dm-otp/webhooks/*
 *   - Public discovery endpoints  /v1/auth/dm-otp/channels
 *                                /v1/auth/dm-otp/start-info
 *   - Verify endpoints           POST /v1/auth/dm-otp/verify
 *                                GET  /v1/auth/dm-otp/email/click
 *
 * Raw-body capture: webhook signature verification needs the exact
 * bytes the platform signed. We register a content-type parser that
 * stashes `req.rawBody` before JSON-decoding into `req.body`.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';

import type { DmOtpConfig, DmOtpContext, DmOtpLogger } from './context.js';
import { CodeStore } from './lib/code-store.js';
import { IdentityStore } from './lib/identity-store.js';
import type { SendFn } from './lib/dispatcher.js';
import { registerChannelsRoute } from './routes/channels.js';
import { registerVerifyRoute } from './routes/verify.js';
import { registerTelegramWebhook } from './routes/webhooks/telegram.js';
import { registerMetaWebhooks } from './routes/webhooks/meta.js';
import { registerDiscordWebhook } from './routes/webhooks/discord.js';
import { registerSlackWebhook } from './routes/webhooks/slack.js';
import { registerLineWebhook } from './routes/webhooks/line.js';
import { registerViberWebhook } from './routes/webhooks/viber.js';
import { registerXWebhook } from './routes/webhooks/x.js';
import { registerTeamsWebhook } from './routes/webhooks/teams.js';
import { registerMastodonWebhook } from './routes/webhooks/mastodon.js';
import { registerRedditWebhook } from './routes/webhooks/reddit.js';
import { registerSignalWebhook } from './routes/webhooks/signal.js';
import { registerEmailWebhook } from './routes/webhooks/email.js';
import { registerLinkedInWebhook } from './routes/webhooks/linkedin.js';

import { sendTelegramOtp } from './lib/replies/telegram.js';
import { sendWhatsAppOtp } from './lib/replies/whatsapp.js';
import { sendMessengerOtp } from './lib/replies/messenger.js';
import { sendInstagramOtp } from './lib/replies/instagram.js';
import { sendDiscordOtp, createDmChannel } from './lib/replies/discord.js';
import { sendXOtp } from './lib/replies/x.js';
import { sendRedditOtp } from './lib/replies/reddit.js';
import { sendThreadsOtp } from './lib/replies/threads.js';
import { sendSlackOtp } from './lib/replies/slack.js';
import { sendMastodonOtp } from './lib/replies/mastodon.js';
import { sendLineOtp } from './lib/replies/line.js';
import { sendViberOtp } from './lib/replies/viber.js';
import { sendTeamsOtp } from './lib/replies/teams.js';
import { sendLinkedInOtp } from './lib/replies/linkedin.js';
import { sendSignalOtp } from './lib/replies/signal.js';
import { sendEmailMagicLink } from './lib/replies/email.js';

const PORT = Number(process.env.DM_OTP_PORT ?? 3331);
const BIND = process.env.DM_OTP_BIND ?? '0.0.0.0';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

function envOrDevDefault(key: string, prefix: string): string {
  const v = process.env[key];
  if (v && v.length >= 32) return v;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${key} is required in production and must be at least 32 chars`);
  }
  return `${prefix}-INSECURE-DEV-ONLY-DO-NOT-USE-IN-PROD-${'x'.repeat(16)}`;
}

export interface BuildOptions {
  ctx?: DmOtpContext;
}

export async function buildServer(opts: BuildOptions = {}): Promise<FastifyInstance> {
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

  // Capture raw body bytes for signature verification BEFORE JSON parsing.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      (req as unknown as { rawBody: string }).rawBody = body as string;
      try {
        const json = (body as string).length ? JSON.parse(body as string) : {};
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );
  // Also catch form-urlencoded for Mailgun-style inbound webhooks.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (req, body, done) => {
      (req as unknown as { rawBody: string }).rawBody = body as string;
      try {
        const params = new URLSearchParams(body as string);
        const obj: Record<string, string> = {};
        for (const [k, v] of params) obj[k] = v;
        done(null, obj);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  const corsOrigins = (
    process.env.DM_OTP_CORS_ORIGINS ??
    'https://vtourn.com,https://vtorn.aiva.nz,https://vtorn-auth.aiva.nz,http://localhost:3300'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

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
      service: 'vtourn-dm-otp',
      version: '0.1.0',
      health: '/health',
    };
  });

  app.get('/health', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { status: 'ok', ts: new Date().toISOString() };
  });

  // Public discovery + verify.
  await registerChannelsRoute(app);
  await registerVerifyRoute(app, ctx);

  // Inbound webhooks.
  await registerTelegramWebhook(app, ctx);
  await registerMetaWebhooks(app, ctx);
  await registerDiscordWebhook(app, ctx);
  await registerSlackWebhook(app, ctx);
  await registerLineWebhook(app, ctx);
  await registerViberWebhook(app, ctx);
  await registerXWebhook(app, ctx);
  await registerTeamsWebhook(app, ctx);
  await registerMastodonWebhook(app, ctx);
  await registerRedditWebhook(app, ctx);
  await registerSignalWebhook(app, ctx);
  await registerEmailWebhook(app, ctx);
  await registerLinkedInWebhook(app, ctx);

  // Background prune of expired codes every minute.
  const pruneInterval = setInterval(() => {
    try {
      ctx.store.prune();
    } catch {
      /* ignore */
    }
  }, 60_000);
  pruneInterval.unref?.();

  app.addHook('onClose', async () => {
    clearInterval(pruneInterval);
  });

  return app;
}

function buildDefaultContext(app: FastifyInstance): DmOtpContext {
  const config: DmOtpConfig = {
    otpSecret: envOrDevDefault('DM_OTP_OTP_SECRET', 'dm-otp-secret'),
    jwtSecret: envOrDevDefault('DM_OTP_JWT_SECRET', 'dm-otp-jwt'),
    productName: process.env.DM_OTP_PRODUCT_NAME ?? 'VTourn',
    appHost: process.env.DM_OTP_APP_HOST ?? 'vtourn.com',
    appBaseUrl: process.env.DM_OTP_APP_BASE_URL ?? 'https://vtourn.com',
    codeTtlSeconds: Number(process.env.DM_OTP_CODE_TTL_SECONDS ?? 300),
    sessionTtlSeconds: Number(
      process.env.DM_OTP_SESSION_TTL_SECONDS ?? 30 * 24 * 60 * 60,
    ),
    metaAppSecret: process.env.META_APP_SECRET ?? '',
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
    discordPublicKey: process.env.DISCORD_PUBLIC_KEY ?? '',
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET ?? '',
    lineChannelSecret: process.env.LINE_CHANNEL_SECRET ?? '',
    viberAuthToken: process.env.VIBER_AUTH_TOKEN ?? '',
    xConsumerSecret: process.env.X_CONSUMER_SECRET ?? '',
    mailgunSigningKey: process.env.MAILGUN_SIGNING_KEY ?? '',
    mastodonInboundBearer: process.env.MASTODON_INBOUND_BEARER ?? '',
    redditPollerBearer: process.env.REDDIT_POLLER_BEARER ?? '',
    signalPollerBearer: process.env.SIGNAL_POLLER_BEARER ?? '',
    teamsAppId: process.env.MS_BOT_APP_ID ?? '',
    teamsAppPassword: process.env.MS_BOT_APP_PASSWORD ?? '',
    enabledChannels: process.env.DM_OTP_ENABLED_CHANNELS ?? '',
  };

  const store = new CodeStore({
    ttlSeconds: config.codeTtlSeconds,
    secret: config.otpSecret,
  });
  const identityStore = new IdentityStore();

  const log: DmOtpLogger = {
    info: (obj, msg) => app.log.info(obj as object, msg),
    warn: (obj, msg) => app.log.warn(obj as object, msg),
    error: (obj, msg) => app.log.error(obj as object, msg),
  };

  const senders = new Map<string, SendFn>();

  // Original four
  if (config.telegramBotToken) {
    senders.set('telegram', async (chatId, code) =>
      sendTelegramOtp({ botToken: config.telegramBotToken }, chatId, code),
    );
  }
  if (process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN) {
    senders.set('whatsapp', async (msisdn, code) =>
      sendWhatsAppOtp(
        {
          phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID as string,
          accessToken: process.env.WHATSAPP_ACCESS_TOKEN as string,
        },
        msisdn,
        code,
      ),
    );
  }
  if (process.env.META_PAGE_ACCESS_TOKEN) {
    senders.set('messenger', async (psid, code) =>
      sendMessengerOtp({ pageAccessToken: process.env.META_PAGE_ACCESS_TOKEN as string }, psid, code),
    );
  }
  if (process.env.INSTAGRAM_PAGE_ACCESS_TOKEN) {
    senders.set('instagram', async (igsid, code) =>
      sendInstagramOtp({ pageAccessToken: process.env.INSTAGRAM_PAGE_ACCESS_TOKEN as string }, igsid, code),
    );
  }

  // Expansion: 12 more
  if (process.env.DISCORD_BOT_TOKEN) {
    senders.set('discord', async (userId, code, meta) => {
      const cfg = { botToken: process.env.DISCORD_BOT_TOKEN as string };
      let channelId = meta?.channelId;
      if (!channelId) {
        const opened = await createDmChannel(cfg, userId);
        if (!opened.ok) {
          return { ok: false, status: opened.status, detail: 'discord-open-dm-failed' };
        }
        channelId = opened.channelId;
      }
      return sendDiscordOtp(cfg, channelId, code);
    });
  }
  if (process.env.X_BEARER_TOKEN) {
    senders.set('x', async (userId, code) =>
      sendXOtp({ bearerToken: process.env.X_BEARER_TOKEN as string }, userId, code),
    );
  }
  if (
    process.env.REDDIT_CLIENT_ID &&
    process.env.REDDIT_CLIENT_SECRET &&
    process.env.REDDIT_USERNAME &&
    process.env.REDDIT_PASSWORD
  ) {
    senders.set('reddit', async (username, code) =>
      sendRedditOtp(
        {
          clientId: process.env.REDDIT_CLIENT_ID as string,
          clientSecret: process.env.REDDIT_CLIENT_SECRET as string,
          username: process.env.REDDIT_USERNAME as string,
          password: process.env.REDDIT_PASSWORD as string,
          userAgent: process.env.REDDIT_USER_AGENT ?? 'vtourn-dm-otp/0.1',
        },
        username,
        code,
      ),
    );
  }
  if (process.env.THREADS_PAGE_ACCESS_TOKEN) {
    senders.set('threads', async (rid, code) =>
      sendThreadsOtp({ pageAccessToken: process.env.THREADS_PAGE_ACCESS_TOKEN as string }, rid, code),
    );
  }
  if (process.env.SLACK_BOT_TOKEN) {
    senders.set('slack', async (userId, code, meta) =>
      // Slack DM scope: post to user-id (channel param accepts U... ids).
      sendSlackOtp(
        { botToken: process.env.SLACK_BOT_TOKEN as string },
        meta?.channelId ?? userId,
        code,
      ),
    );
  }
  if (process.env.MASTODON_ACCESS_TOKEN && process.env.MASTODON_INSTANCE) {
    senders.set('mastodon', async (handle, code) =>
      sendMastodonOtp(
        {
          instance: process.env.MASTODON_INSTANCE as string,
          accessToken: process.env.MASTODON_ACCESS_TOKEN as string,
        },
        handle,
        code,
      ),
    );
  }
  if (process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    senders.set('line', async (userId, code) =>
      sendLineOtp({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN as string }, userId, code),
    );
  }
  if (process.env.VIBER_AUTH_TOKEN) {
    senders.set('viber', async (userId, code) =>
      sendViberOtp(
        {
          authToken: process.env.VIBER_AUTH_TOKEN as string,
          senderName: process.env.VIBER_SENDER_NAME ?? 'VTourn',
        },
        userId,
        code,
      ),
    );
  }
  if (process.env.MS_BOT_APP_ID && process.env.MS_BOT_APP_PASSWORD) {
    senders.set('teams', async (_userId, code, meta) => {
      const serviceUrl = meta?.serviceUrl;
      const conversationId = meta?.conversationId;
      if (!serviceUrl || !conversationId) {
        return { ok: false, detail: 'teams-missing-conversation-ref' };
      }
      return sendTeamsOtp(
        {
          appId: process.env.MS_BOT_APP_ID as string,
          appPassword: process.env.MS_BOT_APP_PASSWORD as string,
          tenantId: process.env.MS_BOT_TENANT_ID,
        },
        { serviceUrl, conversationId },
        code,
      );
    });
  }
  if (process.env.LINKEDIN_ACCESS_TOKEN) {
    senders.set('linkedin', async (urn, code) =>
      sendLinkedInOtp(
        {
          accessToken: process.env.LINKEDIN_ACCESS_TOKEN as string,
          fromUrn: process.env.LINKEDIN_FROM_URN as string,
        },
        urn,
        code,
      ),
    );
  }
  if (process.env.SIGNAL_API_URL && process.env.SIGNAL_BOT_NUMBER) {
    senders.set('signal', async (number, code) =>
      sendSignalOtp(
        {
          apiBaseUrl: process.env.SIGNAL_API_URL as string,
          botNumber: process.env.SIGNAL_BOT_NUMBER as string,
        },
        number,
        code,
      ),
    );
  }
  if (process.env.EMAIL_SMTP_HOST) {
    senders.set('email', async (toAddress, token) =>
      sendEmailMagicLink(
        {
          smtpHost: process.env.EMAIL_SMTP_HOST as string,
          smtpPort: Number(process.env.EMAIL_SMTP_PORT ?? 465),
          smtpUser: process.env.EMAIL_SMTP_USER ?? '',
          smtpPass: process.env.EMAIL_SMTP_PASS ?? '',
          fromAddress:
            process.env.EMAIL_FROM_ADDRESS ?? 'login@vtourn.com',
          fromName: process.env.EMAIL_FROM_NAME ?? 'VTourn',
          appBaseUrl: config.appBaseUrl,
        },
        { to: toAddress, token },
      ),
    );
  }

  return {
    store,
    identityStore,
    senders,
    magicLinkChannels: new Set(['email']),
    config,
    log,
    now: () => Date.now(),
  };
}

async function start(): Promise<void> {
  const app = await buildServer();
  try {
    await app.listen({ port: PORT, host: BIND });
    app.log.info({ port: PORT, bind: BIND }, `vtourn-dm-otp listening on http://${BIND}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void start();
}
