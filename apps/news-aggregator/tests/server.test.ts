/**
 * End-to-end smoke for the Fastify server. Starts a server with the
 * scheduler disabled, hand-pushes a few items into the store, and
 * verifies routes + cache headers.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildServer } from '../src/index.js';
import type { NewsItem } from '../src/types.js';

let dir: string;
let app: Awaited<ReturnType<typeof buildServer>>['app'];
let store: Awaited<ReturnType<typeof buildServer>>['store'];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'news-server-'));
  const built = await buildServer({
    cachePath: join(dir, 'cache.jsonl'),
    startScheduler: false,
    adminSecret: 'test-secret',
  });
  app = built.app;
  store = built.store;
  await app.ready();

  const items: NewsItem[] = [
    {
      id: 'fixture-1',
      title: 'Mexico opens World Cup 2026',
      summary: 'Estadio Azteca will host the opener.',
      url: 'https://example.com/wc-mx',
      source: 'BBC Sport',
      publishedAt: '2026-05-11T10:00:00.000Z',
      language: 'en',
      tags: ['football', 'wc2026'],
    },
    {
      id: 'fixture-2',
      title: 'Argentina release squad',
      summary: 'Messi captains the squad.',
      url: 'https://example.com/arg-squad',
      source: 'The Guardian',
      publishedAt: '2026-05-10T10:00:00.000Z',
      language: 'en',
      tags: ['football'],
    },
    {
      id: 'fixture-3',
      title: 'España convoca a su lista',
      summary: 'Lista para amistosos.',
      url: 'https://example.com/esp',
      source: 'Marca',
      publishedAt: '2026-05-09T10:00:00.000Z',
      language: 'es',
      tags: ['football'],
    },
  ];
  await store.insertMany(items);
});

afterAll(async () => {
  await app.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});

describe('news-aggregator HTTP', () => {
  it('GET /healthz returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('GET /v1/news lists items newest-first with cache headers + ETag', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/news' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: NewsItem[]; total: number; latestPublishedAt: string };
    expect(body.items[0].id).toBe('fixture-1');
    expect(body.total).toBe(2); // default lang=en hides the Spanish row
    expect(body.latestPublishedAt).toBe('2026-05-11T10:00:00.000Z');
    expect(res.headers['cache-control']).toContain('s-maxage=120');
    expect(res.headers['etag']).toMatch(/^W\//);
  });

  it('GET /v1/news?lang=es surfaces Spanish content', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/news?lang=es' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: NewsItem[] };
    expect(body.items[0].id).toBe('fixture-3');
  });

  it('GET /v1/news?source=BBC%20Sport filters by source', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/news?source=BBC+Sport' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: NewsItem[] };
    expect(body.items.every((i) => i.source === 'BBC Sport')).toBe(true);
  });

  it('GET /v1/news?tag=wc2026 filters by tag', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/news?tag=wc2026' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: NewsItem[] };
    expect(body.items.length).toBe(1);
    expect(body.items[0].id).toBe('fixture-1');
  });

  it('GET /v1/news/:id returns one item', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/news/fixture-2' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as NewsItem;
    expect(body.id).toBe('fixture-2');
  });

  it('GET /v1/news/:id returns 404 when not found', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/news/never-existed' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /v1/sources returns the configured source list with health', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/sources' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sources: { id: string; enabled: boolean }[] };
    const ids = body.sources.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['bbc', 'theguardian', 'espn', 'fifa', 'goal', 'marca']));
  });

  it('POST /v1/admin/refresh requires the bearer token', async () => {
    const noAuth = await app.inject({ method: 'POST', url: '/v1/admin/refresh' });
    expect(noAuth.statusCode).toBe(401);

    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/admin/refresh',
      headers: { authorization: 'Bearer wrong' },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('GET /v1/news with If-None-Match returns 304', async () => {
    const first = await app.inject({ method: 'GET', url: '/v1/news' });
    const etag = first.headers['etag'] as string;
    const cached = await app.inject({
      method: 'GET',
      url: '/v1/news',
      headers: { 'if-none-match': etag },
    });
    expect(cached.statusCode).toBe(304);
  });
});
