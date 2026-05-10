/**
 * dm-poll-forwarder entrypoint.
 *
 * Boots the scheduler with three pollers (Reddit/Mastodon/Signal) and a
 * Fastify control server on :3404.
 *
 * Two backends:
 *   - POLL_BACKEND=mock  (default): in-memory fixtures, no network.
 *   - POLL_BACKEND=real: real APIs using *_API tokens from env.
 *
 * The mock backend lets an operator boot the worker against a local
 * dm-otp instance to smoke-test the end-to-end path without setting up
 * Reddit/Mastodon/Signal accounts. Tests use the mock backend.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { resolve } from 'node:path';

import { CursorStore } from './lib/cursors.js';
import { DeadLetterQueue } from './lib/dead-letter.js';
import { Forwarder } from './lib/forwarder.js';
import { Scheduler } from './lib/scheduler.js';
import { registerControlRoutes } from './routes/control.js';
import { registerSwagger } from './swagger.js';
import { MockPoller } from './pollers/mock.js';
import { RedditPoller } from './pollers/reddit-poller.js';
import { MastodonPoller, type MastodonInstanceConfig } from './pollers/mastodon-poller.js';
import { SignalPoller } from './pollers/signal-poller.js';
import type { Logger } from './lib/log.js';
import type { Poller } from './pollers/types.js';
import type { SchedulerEntry } from './lib/scheduler.js';
import { CHANNELS, type Channel } from './types.js';

export const VERSION = '0.1.0';

const PORT = Number(process.env.POLL_FORWARDER_PORT ?? 3404);
const BIND = process.env.POLL_FORWARDER_BIND ?? '0.0.0.0';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

const DEFAULT_INTERVALS: Record<Channel, number> = {
  reddit: Number(process.env.POLL_INTERVAL_REDDIT_MS ?? 30_000),
  mastodon: Number(process.env.POLL_INTERVAL_MASTODON_MS ?? 20_000),
  signal: Number(process.env.POLL_INTERVAL_SIGNAL_MS ?? 15_000),
};

function adminTokenOrDevDefault(): string {
  const t = process.env.POLL_ADMIN_TOKEN;
  if (t && t.length >= 32) return t;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('POLL_ADMIN_TOKEN must be at least 32 chars in production');
  }
  return 'INSECURE-DEV-ADMIN-TOKEN-DO-NOT-USE-IN-PROD-' + 'x'.repeat(8);
}

function buildPollers(log: Logger): Poller[] {
  const backend = (process.env.POLL_BACKEND ?? 'mock').toLowerCase();
  if (backend === 'mock') {
    log.info({ backend: 'mock' }, 'dm-poll-forwarder using mock pollers');
    const reddit = new MockPoller('reddit');
    const mastodon = new MockPoller('mastodon');
    const signal = new MockPoller('signal');
    if (process.env.POLL_MOCK_SEED === 'true') {
      reddit.enqueue({ id: 1, externalId: 'demo_user', text: 'log in' });
      mastodon.enqueue({ id: 1, externalId: 'demo@mastodon.social', text: 'log in' });
      signal.enqueue({ id: 1, externalId: '+15551234567', text: 'log in' });
    }
    return [reddit, mastodon, signal];
  }
  log.info({ backend: 'real' }, 'dm-poll-forwarder using real pollers');
  const out: Poller[] = [];
  if (
    process.env.REDDIT_CLIENT_ID &&
    process.env.REDDIT_CLIENT_SECRET &&
    process.env.REDDIT_USERNAME &&
    process.env.REDDIT_PASSWORD
  ) {
    out.push(
      new RedditPoller({
        clientId: process.env.REDDIT_CLIENT_ID,
        clientSecret: process.env.REDDIT_CLIENT_SECRET,
        username: process.env.REDDIT_USERNAME,
        password: process.env.REDDIT_PASSWORD,
        userAgent: process.env.REDDIT_USER_AGENT,
      }),
    );
  } else {
    log.warn({}, 'reddit poller disabled — missing REDDIT_* env');
  }
  const mastodonInstances = parseMastodonInstances(process.env.MASTODON_INSTANCES);
  if (mastodonInstances.length > 0) {
    out.push(new MastodonPoller({ instances: mastodonInstances }));
  } else {
    log.warn({}, 'mastodon poller disabled — MASTODON_INSTANCES is empty');
  }
  if (process.env.SIGNAL_API_URL && process.env.SIGNAL_BOT_NUMBER) {
    out.push(
      new SignalPoller({
        apiBaseUrl: process.env.SIGNAL_API_URL,
        botNumber: process.env.SIGNAL_BOT_NUMBER,
      }),
    );
  } else {
    log.warn({}, 'signal poller disabled — missing SIGNAL_API_URL or SIGNAL_BOT_NUMBER');
  }
  return out;
}

/**
 * Parse MASTODON_INSTANCES env: a semicolon-separated list of
 * `host=token` pairs. e.g. `mastodon.social=abc;mas.to=def`.
 */
function parseMastodonInstances(raw: string | undefined): MastodonInstanceConfig[] {
  if (!raw) return [];
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq <= 0) return null;
      return { host: pair.slice(0, eq), accessToken: pair.slice(eq + 1) };
    })
    .filter((x): x is MastodonInstanceConfig => x !== null && Boolean(x.host && x.accessToken));
}

export interface BuildOptions {
  scheduler?: Scheduler;
  forwarder?: Forwarder;
  deadLetter?: DeadLetterQueue;
  cursors?: CursorStore;
  adminToken?: string;
}

export async function buildServer(opts: BuildOptions = {}): Promise<{
  app: FastifyInstance;
  scheduler: Scheduler;
  forwarder: Forwarder;
  deadLetter: DeadLetterQueue;
  cursors: CursorStore;
}> {
  const usePretty =
    process.env.NODE_ENV !== 'production' &&
    process.env.NODE_ENV !== 'test' &&
    process.env.POLL_FORWARDER_PRETTY_LOGS !== 'false';
  const app = Fastify({
    logger: {
      level: LOG_LEVEL,
      transport: usePretty ? { target: 'pino-pretty' } : undefined,
    },
    disableRequestLogging: process.env.NODE_ENV !== 'production',
    trustProxy: true,
  });
  await app.register(sensible);
  await registerSwagger(app);

  const log: Logger = {
    info: (obj, msg) => app.log.info(obj as object, msg),
    warn: (obj, msg) => app.log.warn(obj as object, msg),
    error: (obj, msg) => app.log.error(obj as object, msg),
  };

  const dataDir = process.env.POLL_DATA_DIR ?? resolve(process.cwd(), 'data');
  const cursors =
    opts.cursors ?? new CursorStore({ path: resolve(dataDir, 'cursors.jsonl') });
  await cursors.load();
  const deadLetter =
    opts.deadLetter ?? new DeadLetterQueue(resolve(dataDir, 'forward-failed.jsonl'));

  const dmOtpBase = process.env.DM_OTP_BASE_URL ?? 'http://127.0.0.1:3331';
  const bearer = process.env.POLL_FORWARDER_BEARER ?? '';
  const forwarder =
    opts.forwarder ??
    new Forwarder({
      baseUrl: dmOtpBase,
      bearer,
      deadLetter,
      log,
    });

  const scheduler =
    opts.scheduler ??
    (() => {
      const pollers = buildPollers(log);
      const entries: SchedulerEntry[] = pollers.map((p) => ({
        poller: p,
        intervalMs: DEFAULT_INTERVALS[p.channel as Channel],
      }));
      // Add disabled placeholders for any channel without a poller so the
      // status endpoint still reports a row.
      for (const ch of CHANNELS) {
        if (entries.find((e) => e.poller.channel === ch)) continue;
        entries.push({
          poller: { channel: ch, description: 'disabled', poll: async () => ({ messages: [], cursor: undefined }) },
          intervalMs: DEFAULT_INTERVALS[ch],
          enabled: false,
        });
      }
      return new Scheduler({ entries, cursors, forwarder, log });
    })();

  const adminToken = opts.adminToken ?? adminTokenOrDevDefault();

  await registerControlRoutes(app, {
    scheduler,
    forwarder,
    deadLetter,
    adminToken,
    version: VERSION,
  });

  app.addHook('onClose', async () => {
    await scheduler.stop();
  });

  return { app, scheduler, forwarder, deadLetter, cursors };
}

async function start(): Promise<void> {
  const { app, scheduler } = await buildServer();
  scheduler.start();
  const shutdown = async (sig: string): Promise<void> => {
    app.log.info({ sig }, 'shutting down');
    try {
      await scheduler.stop();
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'shutdown error');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  try {
    await app.listen({ port: PORT, host: BIND });
    app.log.info({ port: PORT, bind: BIND }, `vtorn-dm-poll-forwarder listening on http://${BIND}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void start();
}
