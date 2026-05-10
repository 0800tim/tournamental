/**
 * Swagger / OpenAPI registration for @vtorn/api.
 *
 * Mounts:
 *   GET /docs            Swagger UI
 *   GET /docs/json       OpenAPI 3.0 JSON
 *   GET /docs/yaml       OpenAPI 3.0 YAML
 *
 * The generated spec is also dumped to docs/api/api.openapi.json by
 * scripts/dump-openapi.ts so consumers (the dashboard, internal tooling)
 * have a static copy that doesn't require booting the service.
 */

import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

const PORT = Number(process.env.VTORN_API_PORT ?? 3310);

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
        title: 'VTorn API',
        description:
          'Public VTorn API surface. Health, version, and aggregate endpoints. ' +
          'See docs/03-architecture.md for the full system topology.',
        version: '0.0.1',
        license: { name: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
      },
      servers: [
        { url: `http://localhost:${PORT}`, description: 'local dev' },
        { url: 'https://vtorn-api.aiva.nz', description: 'dev tunnel' },
      ],
      tags: [
        { name: 'health', description: 'Liveness + version' },
        { name: 'social-cards', description: 'OG card rendering' },
        { name: 'admin', description: 'Operator-only endpoints' },
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
