/**
 * Fastify HTTP server for @vtorn/social-publisher.
 *
 * Responsibilities:
 *   - POST /v1/publish   — accept a ClipReady event, fan out per policy.
 *   - GET  /v1/version   — service identity (for health dashboards).
 *   - GET  /healthz      — liveness + adapter count.
 *
 * The Redis stream listener is a TODO (see src/index.ts). For v0.1 every
 * upstream caller (clip-pipeline) POSTs the ClipReady event directly.
 */

import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Logger } from 'pino';

import { adapterModes } from './lib/adapter-mode.js';
import { ALL_PLATFORMS } from './lib/adapters/index.js';
import type { AuditLog } from './lib/audit-log.js';
import type { SocialPolicy } from './lib/policy.js';
import { publishClip } from './lib/publish.js';
import { ClipReadySchema } from './types.js';

export const SERVICE_VERSION = '0.0.1';

export interface BuildAppOptions {
  policy: SocialPolicy;
  auditLog: AuditLog;
  logger?: Logger | false;
  now?: () => number;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify(
    opts.logger
      ? {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          loggerInstance: opts.logger as unknown as any,
          disableRequestLogging: true,
        }
      : { logger: false, disableRequestLogging: true },
  );

  await app.register(cors, { origin: true });

  // Swagger MUST be awaited so its onRoute hook captures every route below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(swagger as any, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Social-Publisher API',
        description:
          'Multi-platform fan-out for VTorn match clips and bracket cards.',
        version: SERVICE_VERSION,
        license: { name: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
      },
      servers: [
        { url: 'http://localhost:3382', description: 'local dev' },
        { url: 'https://social.tournamental.com', description: 'production' },
      ],
      tags: [{ name: 'publish', description: 'ClipReady fan-out' }],
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(swaggerUi as any, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
    staticCSP: true,
  });

  app.get('/healthz', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return {
      ok: true,
      service: 'social-publisher',
      adapters: ALL_PLATFORMS,
      adapter_modes: adapterModes(),
      ts: Date.now(),
    };
  });

  app.get('/v1/version', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return {
      service: 'social-publisher',
      version: SERVICE_VERSION,
      adapter_count: ALL_PLATFORMS.length,
    };
  });

  app.post('/v1/publish', async (req, reply) => {
    const parsed = ClipReadySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400).header('Cache-Control', 'no-store');
      return {
        error: 'invalid_clip_ready',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      };
    }
    const clip = parsed.data;
    const outcomes = await publishClip(clip, {
      policy: opts.policy,
      log: opts.auditLog,
      logger: opts.logger || undefined,
      now: opts.now,
    });
    reply.header('Cache-Control', 'no-store');
    return {
      clipId: clip.clipId,
      tournamentId: clip.tournamentId,
      eventType: clip.eventType,
      results: outcomes,
    };
  });

  return app;
}
