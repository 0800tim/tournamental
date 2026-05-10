#!/usr/bin/env node
/**
 * social-publisher entrypoint. Boots the Fastify server on :3382.
 *
 * Env vars:
 *   SOCIAL_PUBLISHER_PORT     default 3382
 *   SOCIAL_PUBLISHER_BIND     default 0.0.0.0
 *   SOCIAL_PUBLISHER_LOG_PATH default ./data/posts.jsonl
 *   SOCIAL_PUBLISHER_POLICY   override path to social-policy.json
 *   LOG_LEVEL                 default 'info'
 *
 * TODO (v0.2): replace the HTTP POST /v1/publish ingress with a Redis
 * stream listener subscribed to `clip.ready`. The clip-pipeline already
 * has the producer side stubbed (see apps/clip-pipeline/src/queue.ts);
 * once it emits real events, swap this entrypoint to consume from the
 * stream and keep POST /v1/publish as a manual-test fallback.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pino } from 'pino';

import { AuditLog } from './lib/audit-log.js';
import { loadPolicy } from './lib/policy.js';
import { buildApp } from './server.js';

const PORT = Number(process.env.SOCIAL_PUBLISHER_PORT ?? 3382);
const BIND = process.env.SOCIAL_PUBLISHER_BIND ?? '0.0.0.0';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

function defaultLogPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/index.ts (or dist/index.js) → ../data/posts.jsonl
  return join(here, '..', 'data', 'posts.jsonl');
}

async function main(): Promise<void> {
  const logger = pino({
    level: LOG_LEVEL,
    base: { service: 'social-publisher' },
  });

  const policy = loadPolicy(process.env.SOCIAL_PUBLISHER_POLICY);
  const auditLog = new AuditLog(process.env.SOCIAL_PUBLISHER_LOG_PATH ?? defaultLogPath());

  const app = buildApp({ policy, auditLog, logger });
  await app.listen({ port: PORT, host: BIND });
  logger.info(
    { port: PORT, bind: BIND, policy_keys: Object.keys(policy.default).length },
    'social-publisher listening',
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    try {
      await app.close();
    } catch (err) {
      logger.warn({ err }, 'error closing http server');
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('social-publisher fatal:', err);
  process.exit(1);
});
