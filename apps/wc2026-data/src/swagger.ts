/**
 * Swagger / OpenAPI registration for @vtorn/wc2026-data-scripts.
 *
 * Mounts:
 *   GET /docs            Swagger UI
 *   GET /docs/json       OpenAPI 3.0 JSON
 *
 * The generated spec is also dumped to docs/api/<service>.openapi.json by
 * scripts/dump-openapi.ts so consumers (the dashboard, internal tooling)
 * have a static copy that doesn't require booting the service.
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
        title: 'WC2026 Live-Data API',
        description:
          'Live match-state stream service for the 2026 World Cup. Provider abstraction + Fastify SSE.',
        version: '0.1.0',
        license: { name: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
      },
      servers: [
        { url: 'http://localhost:3411', description: 'local dev' },
        { url: 'https://wc2026.tournamental.com', description: 'production' },
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
