/**
 * Swagger / OpenAPI registration for @vtorn/game.
 *
 * Mounts:
 *   GET /docs            Swagger UI
 *   GET /docs/json       OpenAPI 3.0 JSON
 *
 * NOTE TO ORCHESTRATOR: this file is intentionally not yet wired into
 * `src/server.ts` because that file is in flight (per-match-pick-popup
 * agent owns it). When their PR lands, add:
 *
 *   import { registerSwagger } from './swagger.js';
 *   ...
 *   await registerSwagger(app);   // immediately after `app.register(sensible)`
 *
 * Until then, the `dump-openapi` script registers swagger out-of-band
 * (see scripts/dump-openapi.run.ts).
 */

import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

export async function registerSwagger(app: FastifyInstance): Promise<void> {
  // Idempotent guard — Fastify throws on double-registration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((app as any).__vtornSwaggerRegistered) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app as any).__vtornSwaggerRegistered = true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(swagger as any, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Game API',
        description:
          'Bracket submission, match-result settlement, leaderboards, syndicates, Verified-Pundits.',
        version: '0.1.0',
        license: { name: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
      },
      servers: [
        { url: 'http://localhost:3360', description: 'local dev' },
        { url: 'https://vtorn-game.aiva.nz', description: 'dev tunnel' },
      ],
      tags: [
        { name: 'health', description: 'Liveness + version' },
      ],
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(swaggerUi as any, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
    staticCSP: true,
  });
}
