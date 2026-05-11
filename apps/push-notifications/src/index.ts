/**
 * Tournamental push-notifications service entrypoint.
 *
 * Boots a Fastify HTTP server on :3398. Provides:
 *   - subscribe endpoints for Web Push, Telegram, SMS (consent required)
 *   - notify endpoints for kickoff_soon / match_result / leaderboard_move
 *   - a startup scheduler that scans the tournament's fixtures and arms
 *     `kickoff - 30min` and `kickoff - 5min` timers for the next 24h
 *
 * All channel adapters are stubs in v0.1 — they log to a JSONL audit file
 * (data/audit.jsonl) but do not actually transmit anything.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import { loadFixtures2026 } from '@tournamental/bracket-engine';

import { FileAuditLogger, TeeAuditLogger } from './lib/audit.js';
import { SubscriptionStore } from './lib/subscriptions.js';
import { StubWebPushSender } from './lib/web-push.js';
import { StubTelegramSender } from './lib/telegram.js';
import { AivaSmsAdapter } from './lib/sms.js';
import { WhatsAppPushSender } from './lib/whatsapp.js';
import { Dispatcher, type PreferredChannel } from './lib/dispatcher.js';
import { Scheduler, type ScheduledJob } from './lib/scheduler.js';
import { registerSubscribeRoutes } from './routes/subscribe.js';
import { registerNotifyRoutes } from './routes/notify.js';
import { registerSwagger } from './swagger.js';

const PORT = Number(process.env.PUSH_PORT ?? 3398);
const BIND = process.env.PUSH_BIND ?? '0.0.0.0';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';
const VERSION = '0.1.0';

const corsOrigins = (
  process.env.PUSH_CORS_ORIGINS ??
  'https://tournamental.com,https://play.tournamental.com,https://play.tournamental.com,http://localhost:3300'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export interface BuildOptions {
  /** Path to the JSONL subscription store. Default `./data/subscriptions.jsonl`. */
  subscriptionsPath?: string;
  /** Path to the JSONL audit log. Default `./data/audit.jsonl`. */
  auditPath?: string;
  /** Path to the WhatsApp-only audit log (mirrored from main audit).
   *  Default `./data/whatsapp-audit.jsonl`. */
  whatsappAuditPath?: string;
  /** Path to the privacy-masked SMS audit log. Default `./data/sms-audit.jsonl`. */
  smsAuditPath?: string;
  /** Path to the scheduler state JSON. Default `./data/scheduled-jobs.json`. */
  schedulerStatePath?: string;
  /** If true (default), scan fixtures and arm timers on boot. */
  bootScheduler?: boolean;
  /** If provided, requests to /v1/notify/* must include `x-push-secret`. */
  internalSecret?: string;
  /** SMS↔WhatsApp routing policy. Default 'auto' (WA wins when linked). */
  preferredChannel?: PreferredChannel;
}

export interface BuiltServer {
  app: FastifyInstance;
  store: SubscriptionStore;
  dispatcher: Dispatcher;
  scheduler: Scheduler;
  audit: FileAuditLogger;
}

export async function buildServer(opts: BuildOptions = {}): Promise<BuiltServer> {
  const usePretty =
    process.env.NODE_ENV !== 'production' &&
    process.env.NODE_ENV !== 'test' &&
    process.env.PUSH_PRETTY_LOGS !== 'false';

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

  const auditPath = opts.auditPath ?? './data/audit.jsonl';
  const whatsappAuditPath =
    opts.whatsappAuditPath ?? './data/whatsapp-audit.jsonl';
  const subsPath = opts.subscriptionsPath ?? './data/subscriptions.jsonl';
  const schedStatePath =
    opts.schedulerStatePath ?? './data/scheduled-jobs.json';

  const audit = new FileAuditLogger(auditPath);
  const whatsappAudit = new FileAuditLogger(whatsappAuditPath);
  // Tee: WA sends land in both the channel-specific log and the main one.
  const whatsappTee = new TeeAuditLogger([whatsappAudit, audit]);
  const store = SubscriptionStore.memory();
  await store.useFile(subsPath);

  const webPush = new StubWebPushSender({
    audit,
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
    vapidSubject: process.env.VAPID_SUBJECT,
  });
  const telegram = new StubTelegramSender({
    audit,
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    pushUrl: process.env.TOURNAMENT_BOT_PUSH_URL,
    pushSecret: process.env.TOURNAMENT_BOT_PUSH_SECRET,
  });
  const sms = new AivaSmsAdapter({
    audit,
    smsAuditPath: opts.smsAuditPath ?? './data/sms-audit.jsonl',
    apiUrl: process.env.AIVA_SMS_API_URL ?? process.env.AIVA_SMS_URL,
    apiKey: process.env.AIVA_SMS_API_KEY,
    deviceId: process.env.AIVA_SMS_DEVICE_ID,
    log: (msg) => app.log.warn(msg),
  });
  const whatsapp = new WhatsAppPushSender({
    audit: whatsappTee,
    apiUrl: process.env.AIVA_SMS_API_URL ?? process.env.AIVA_SMS_URL,
    apiKey: process.env.AIVA_SMS_API_KEY,
    sessionId: process.env.AIVA_WA_SESSION_ID,
  });

  const envPolicy = (process.env.PUSH_PREFERRED_CHANNEL ??
    'auto') as PreferredChannel;
  const policy: PreferredChannel =
    opts.preferredChannel ??
    (envPolicy === 'whatsapp' || envPolicy === 'sms' ? envPolicy : 'auto');

  const dispatcher = new Dispatcher({
    store,
    webPush,
    telegram,
    sms,
    whatsapp,
    preferredChannel: policy,
  });

  // Scheduler — its onFire callback uses the dispatcher to fan-out the
  // kickoff_soon notification to everyone who picked the match.
  const scheduler = new Scheduler({
    audit,
    statePath: schedStatePath,
    onFire: async (job: ScheduledJob) => {
      const picks = store.picksForMatch(job.matchId);
      const content = Dispatcher.renderKickoff(job.matchId, job.minutesUntil);
      for (const p of picks) {
        await dispatcher.fanOut(p.userId, 'kickoff_soon', content);
      }
    },
  });
  await scheduler.load();

  // Health + version.
  app.get('/healthz', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { status: 'ok', ts: new Date().toISOString() };
  });
  app.get('/v1/version', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return {
      service: 'vtorn-push-notifications',
      version: VERSION,
      pendingJobs: scheduler.pendingCount(),
      subscribers: store.allUserIds().length,
    };
  });

  await registerSubscribeRoutes(app, { store, audit });
  await registerNotifyRoutes(app, {
    store,
    dispatcher,
    internalSecret: opts.internalSecret ?? process.env.PUSH_INTERNAL_SECRET,
  });

  if (opts.bootScheduler !== false) {
    try {
      const tournament = loadFixtures2026();
      const created = await scheduler.scheduleAll(tournament);
      app.log.info(
        { scheduled: created.length, pending: scheduler.pendingCount() },
        'push-notifications: kickoff scheduler armed',
      );
    } catch (err) {
      app.log.warn(
        { err: String(err) },
        'push-notifications: could not load fixtures; scheduler is empty',
      );
    }
  }

  app.addHook('onClose', async () => {
    scheduler.shutdown();
  });

  return { app, store, dispatcher, scheduler, audit };
}

async function start(): Promise<void> {
  const built = await buildServer();
  try {
    await built.app.listen({ port: PORT, host: BIND });
    built.app.log.info(
      { port: PORT, bind: BIND, corsOrigins, version: VERSION },
      `vtorn-push-notifications listening on http://${BIND}:${PORT}`,
    );
  } catch (err) {
    built.app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void start();
}
