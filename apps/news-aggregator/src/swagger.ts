/**
 * Swagger / OpenAPI registration for @vtorn/news-aggregator.
 *
 * Mounts:
 *   GET /docs            Swagger UI
 *   GET /docs/json       OpenAPI 3.0 JSON
 *   GET /docs/yaml       OpenAPI 3.0 YAML
 *
 * Mirrors the canonical pattern from `apps/api/src/swagger.ts` so the
 * docs hive-mind agent's tooling can pick this service up alongside
 * the rest of the Fastify estate.
 */
import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

const PORT = Number(process.env.NEWS_AGG_PORT ?? 3402);

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
        title: 'VTorn News Aggregator',
        description:
          'Public news aggregator across BBC Sport, the Guardian, ESPN, ' +
          'Marca, FIFA, and Goal.com. Polls every 10 minutes and exposes ' +
          'a normalised JSON API. See docs/49-news-aggregator.md.',
        version: '0.0.1',
        license: { name: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
      },
      servers: [
        { url: `http://localhost:${PORT}`, description: 'local dev' },
        { url: 'https://vtorn-news.aiva.nz', description: 'dev tunnel' },
      ],
      tags: [
        { name: 'health', description: 'Liveness + version' },
        { name: 'news', description: 'Aggregated news items' },
        { name: 'sources', description: 'Configured RSS sources' },
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
