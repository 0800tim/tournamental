/**
 * Fetcher tests using on-disk RSS fixtures.
 *
 * We inject a fake `fetch` so we never hit the network from tests, then
 * assert the parser produces normalised NewsItems with the expected
 * shape per source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { SourceFetcher } from '../src/lib/fetcher.js';
import { descriptor as bbc } from '../src/sources/bbc.js';
import { descriptor as theguardian } from '../src/sources/theguardian.js';
import { descriptor as espn } from '../src/sources/espn.js';
import { descriptor as marca } from '../src/sources/marca.js';
import { descriptor as fifa } from '../src/sources/fifa.js';
import { descriptor as goal } from '../src/sources/goal.js';

const here = dirname(fileURLToPath(import.meta.url));

function fixture(name: string): string {
  return readFileSync(resolve(here, 'fixtures', name), 'utf8');
}

function fakeFetch(map: Record<string, { status?: number; body: string }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const hit = map[url];
    if (!hit) {
      return new Response('not found', { status: 404 });
    }
    return new Response(hit.body, { status: hit.status ?? 200 });
  }) as unknown as typeof fetch;
}

describe('SourceFetcher', () => {
  it('parses the BBC fixture and skips empty rows', async () => {
    const f = new SourceFetcher({ fetcher: fakeFetch({ [bbc.feedUrl]: { body: fixture('bbc.xml') } }) });
    const r = await f.fetchOne(bbc);
    expect(r.ok).toBe(true);
    // 3 rows in fixture; 1 has empty title and should be skipped.
    expect(r.items.length).toBe(2);
    expect(r.items[0].source).toBe('BBC Sport');
    expect(r.items[0].language).toBe('en');
    expect(r.items[0].url.startsWith('https://www.bbc.co.uk/')).toBe(true);
    // Thumbnail picked up from media:thumbnail
    expect(r.items[0].imageUrl).toContain('ichef.bbci.co.uk');
    // World cup tag inferred
    expect(r.items[0].tags).toContain('world-cup');
  });

  it('parses the Guardian fixture (media:content image, dc:creator ignored)', async () => {
    const f = new SourceFetcher({
      fetcher: fakeFetch({ [theguardian.feedUrl]: { body: fixture('theguardian.xml') } }),
    });
    const r = await f.fetchOne(theguardian);
    expect(r.ok).toBe(true);
    expect(r.items.length).toBe(2);
    expect(r.items[0].imageUrl).toContain('i.guim.co.uk');
    expect(r.items[0].source).toBe('The Guardian');
  });

  it('parses the ESPN fixture', async () => {
    const f = new SourceFetcher({ fetcher: fakeFetch({ [espn.feedUrl]: { body: fixture('espn.xml') } }) });
    const r = await f.fetchOne(espn);
    expect(r.ok).toBe(true);
    expect(r.items.length).toBe(2);
    expect(r.items[0].source).toBe('ESPN');
  });

  it('parses the Marca fixture in Spanish and tags world-cup mentions', async () => {
    const f = new SourceFetcher({ fetcher: fakeFetch({ [marca.feedUrl]: { body: fixture('marca.xml') } }) });
    const r = await f.fetchOne(marca);
    expect(r.ok).toBe(true);
    expect(r.items.length).toBe(2);
    expect(r.items[0].language).toBe('es');
    // First item mentions "Copa del Mundo 2026" so should pick up the WC tag
    expect(r.items[0].tags).toContain('world-cup');
  });

  it('records error count and lastError on HTTP failure', async () => {
    const f = new SourceFetcher({
      fetcher: fakeFetch({ [bbc.feedUrl]: { status: 503, body: 'oops' } }),
    });
    const r = await f.fetchOne(bbc);
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBe(503);
    const h = f.getHealth().find((x) => x.id === bbc.id);
    expect(h!.errorCount).toBe(1);
    expect(h!.lastError).toContain('503');
  });

  it('skips disabled sources without firing an HTTP request', async () => {
    let calls = 0;
    const f = new SourceFetcher({
      fetcher: (async () => {
        calls++;
        return new Response('', { status: 200 });
      }) as unknown as typeof fetch,
    });
    // FIFA + Goal default to enabled=false unless their env vars are set
    const fifaResult = await f.fetchOne(fifa);
    const goalResult = await f.fetchOne(goal);
    expect(fifaResult.ok).toBe(false);
    expect(fifaResult.error).toBe('disabled');
    expect(goalResult.ok).toBe(false);
    expect(goalResult.error).toBe('disabled');
    expect(calls).toBe(0);
  });

  it('fetchAll runs sources concurrently', async () => {
    const f = new SourceFetcher({
      fetcher: fakeFetch({
        [bbc.feedUrl]: { body: fixture('bbc.xml') },
        [theguardian.feedUrl]: { body: fixture('theguardian.xml') },
        [espn.feedUrl]: { body: fixture('espn.xml') },
        [marca.feedUrl]: { body: fixture('marca.xml') },
      }),
    });
    const results = await f.fetchAll([bbc, theguardian, espn, marca]);
    expect(results.every((r) => r.ok)).toBe(true);
    const total = results.reduce((acc, r) => acc + r.items.length, 0);
    expect(total).toBeGreaterThanOrEqual(8);
  });
});
