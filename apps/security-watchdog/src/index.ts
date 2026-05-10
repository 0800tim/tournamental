/**
 * Security watchdog HTTP server.
 *
 * Default port :3416. Exposes:
 *   GET  /healthz
 *   GET  /v1/version
 *   GET  /v1/findings
 *   GET  /v1/findings/:id
 *   POST /v1/findings              (auth: WATCHDOG_API_TOKEN)
 *   POST /v1/findings/:id/ack      (auth)
 *   POST /v1/findings/:id/resolve  (auth)
 *   POST /v1/findings/:id/dismiss  (auth)
 *   GET  /v1/audit-log             (auth)
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { join } from 'node:path';
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';

import { WatchdogStore } from './lib/storage.js';
import { AlertDispatcher } from './alerts/index.js';
import { buildSlackSink } from './alerts/slack.js';
import { buildDiscordSink } from './alerts/discord.js';
import { buildTelegramSink } from './alerts/telegram.js';
import { buildAivaSmsSink } from './alerts/aiva-sms.js';
import { buildEmailSink } from './alerts/email.js';
import { registerFindings } from './routes/findings.js';

const PACKAGE_VERSION = '0.1.0';
const PORT = Number(process.env.WATCHDOG_PORT ?? 3416);
const BIND = process.env.WATCHDOG_BIND ?? '0.0.0.0';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

const DATA_DIR = process.env.WATCHDOG_DATA_DIR ?? join(process.cwd(), 'data');
const FINDINGS_PATH = join(DATA_DIR, 'findings.jsonl');
const AUDIT_PATH = join(DATA_DIR, 'audit.jsonl');
const DEAD_LETTER_PATH = join(DATA_DIR, 'alert-failed.jsonl');

export interface BuildOptions {
  store?: WatchdogStore;
  dispatcher?: AlertDispatcher;
}

export async function buildServer(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const usePretty =
    process.env.NODE_ENV !== 'production' &&
    process.env.NODE_ENV !== 'test' &&
    process.env.WATCHDOG_PRETTY_LOGS !== 'false';

  const app = Fastify({
    logger: {
      level: LOG_LEVEL,
      transport: usePretty ? { target: 'pino-pretty' } : undefined,
    },
    disableRequestLogging: process.env.NODE_ENV !== 'production',
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(sensible);
  await app.register(cors, {
    origin: (process.env.WATCHDOG_CORS_ORIGINS ?? 'https://vtorn-admin.aiva.nz,http://localhost:3340')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    credentials: true,
  });

  const store = opts.store ?? new WatchdogStore({ findingsPath: FINDINGS_PATH, auditPath: AUDIT_PATH });

  const dispatcher =
    opts.dispatcher ??
    new AlertDispatcher({
      sinks: [
        buildSlackSink(),
        buildDiscordSink(),
        buildTelegramSink(),
        buildAivaSmsSink(),
        buildEmailSink(),
      ],
      onFailure: (sink, finding, error) => {
        try {
          if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
          appendFileSync(
            DEAD_LETTER_PATH,
            JSON.stringify({ at: Date.now(), sink, findingId: finding.id, error }) + '\n',
            'utf-8',
          );
        } catch {
          // Last-resort: log only.
          // eslint-disable-next-line no-console
          console.error('dead-letter write failed', error);
        }
      },
    });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/v1/version', async () => ({
    name: '@vtorn/security-watchdog',
    version: PACKAGE_VERSION,
    findingsCount: store.counts(),
  }));

  registerFindings(app, { store, dispatcher });

  return app;
}

async function start() {
  const app = await buildServer();
  await app.listen({ port: PORT, host: BIND });
  app.log.info({ port: PORT }, 'security-watchdog ready');
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
