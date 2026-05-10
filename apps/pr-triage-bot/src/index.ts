/**
 * pr-triage-bot HTTP server (port :3415).
 *
 * This is the optional long-running daemon mode. The preferred deployment
 * is the CLI invoked from a GitHub Actions workflow, which has the right
 * security envelope (no internet exposure, GITHUB_TOKEN limited to repo).
 *
 * The HTTP server here is for self-hosted GitHub orgs that want to point
 * a webhook at a vtorn-triage process they control.
 *
 * Endpoints:
 *   GET  /healthz
 *   GET  /v1/version
 *   POST /v1/triage   { pr, files, ... }   → TriageVerdict
 *   POST /v1/webhook  GitHub webhook payload
 */

import Fastify from 'fastify';
import sensible from '@fastify/sensible';

import { triage } from './lib/triage.js';
import { TriageInputSchema } from './lib/types.js';

const PACKAGE_VERSION = '0.1.0';
const PORT = Number(process.env.PR_TRIAGE_PORT ?? 3415);
const BIND = process.env.PR_TRIAGE_BIND ?? '0.0.0.0';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

export async function buildServer() {
  const usePretty =
    process.env.NODE_ENV !== 'production' &&
    process.env.NODE_ENV !== 'test' &&
    process.env.PR_TRIAGE_PRETTY_LOGS !== 'false';

  const app = Fastify({
    logger: {
      level: LOG_LEVEL,
      transport: usePretty ? { target: 'pino-pretty' } : undefined,
    },
    disableRequestLogging: process.env.NODE_ENV !== 'production',
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024, // 5 MB — webhook payloads can be hefty
  });

  await app.register(sensible);

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/v1/version', async () => ({
    name: '@vtorn/pr-triage-bot',
    version: PACKAGE_VERSION,
  }));

  app.post('/v1/triage', async (req, reply) => {
    const parsed = TriageInputSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_input', issues: parsed.error.issues.slice(0, 20) };
    }
    const verdict = triage(parsed.data, {
      dryRun: process.env.PR_TRIAGE_DRY_RUN === 'true',
    });
    return verdict;
  });

  // Webhook is intentionally minimal. Real production routing should
  // verify HMAC and dispatch to the GitHub API to fetch PR data, but
  // for v0.1 we only acknowledge.
  app.post('/v1/webhook', async (_req, reply) => {
    reply.code(202);
    return { ok: true, note: 'webhook acknowledged; CLI-mode preferred for v0.1' };
  });

  return app;
}

async function start() {
  const app = await buildServer();
  await app.listen({ port: PORT, host: BIND });
  app.log.info({ port: PORT }, 'pr-triage-bot ready');
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
