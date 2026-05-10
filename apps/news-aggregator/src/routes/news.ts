/**
 * Public news routes.
 *
 * `GET /v1/news?limit=&since=&source=&lang=&tag=` — paginated list,
 *   newest first. Defaults: limit=20, lang=en.
 * `GET /v1/news/:id` — single item lookup.
 * `GET /v1/sources` — health snapshot for every configured source.
 * `POST /v1/admin/refresh` — secret-gated forced refresh.
 *
 * Caching:
 *  - The list endpoint sends `Cache-Control: public, s-maxage=120,
 *    stale-while-revalidate=600` so a Cloudflare edge can absorb
 *    spikes; ETag is the `latestPublishedAt` of the store.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { NewsStore } from '../lib/store.js';
import type { SourceFetcher } from '../lib/fetcher.js';
import type { Scheduler } from '../scheduler.js';
import { ALL_SOURCES } from '../sources/index.js';

export interface RegisterNewsOptions {
  readonly store: NewsStore;
  readonly fetcher: SourceFetcher;
  readonly scheduler: Scheduler;
  /** Bearer token required for admin endpoints. Optional only in tests. */
  readonly adminSecret?: string;
}

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  since: z.string().datetime().optional(),
  source: z.string().min(1).max(64).optional(),
  lang: z.string().min(2).max(8).default('en'),
  tag: z.string().min(1).max(64).optional(),
});

export async function registerNews(app: FastifyInstance, opts: RegisterNewsOptions): Promise<void> {
  const { store, fetcher, scheduler, adminSecret } = opts;

  app.get('/v1/news', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_query', details: parsed.error.flatten() };
    }
    const items = store.query(parsed.data);
    const latest = store.getLatestPublishedAt() || 'empty';
    const etag = `W/"${latest}-${items.length}-${parsed.data.limit}"`;
    if (req.headers['if-none-match'] === etag) {
      reply.code(304);
      reply.header('ETag', etag);
      return null;
    }
    reply.header('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
    reply.header('ETag', etag);
    return {
      items,
      total: items.length,
      latestPublishedAt: store.getLatestPublishedAt() || null,
      query: parsed.data,
    };
  });

  app.get('/v1/news/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { id?: string };
    const id = (params.id ?? '').trim();
    if (!id) {
      reply.code(400);
      return { error: 'missing_id' };
    }
    const item = store.byId(id);
    if (!item) {
      reply.code(404);
      reply.header('Cache-Control', 'no-store');
      return { error: 'not_found' };
    }
    reply.header('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=1200');
    return item;
  });

  app.get('/v1/sources', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    const health = fetcher.getHealth();
    const healthById = new Map(health.map((h) => [h.id, h]));
    return {
      sources: ALL_SOURCES.map((s) => {
        const h = healthById.get(s.id);
        return {
          id: s.id,
          displayName: s.displayName,
          homepage: s.homepage,
          language: s.language,
          enabled: s.enabled,
          logoUrl: s.logoUrl ?? null,
          tags: s.defaultTags,
          health: h ?? null,
        };
      }),
      lastSchedulerRun: scheduler.getLastRunAt(),
    };
  });

  app.post('/v1/admin/refresh', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!adminSecret) {
      reply.code(503);
      return { error: 'admin_disabled' };
    }
    const auth = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (auth !== adminSecret) {
      reply.code(401);
      return { error: 'unauthorised' };
    }
    const result = await scheduler.tick();
    return { ok: true, ...result, ranAt: scheduler.getLastRunAt() };
  });
}
