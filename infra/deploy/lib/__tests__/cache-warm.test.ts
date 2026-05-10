import { describe, it, expect, vi } from 'vitest';
import { cacheWarm } from '../cache-warm.js';

describe('cacheWarm', () => {
  it('hits every URL with default headers', async () => {
    const hits: string[] = [];
    const fakeFetch: any = vi.fn(async (url: string, init: any) => {
      hits.push(url);
      expect(init.headers['Accept-Encoding']).toContain('gzip');
      return new Response('ok', { status: 200 });
    });
    const r = await cacheWarm({
      targets: [
        { url: 'http://x/a' },
        { url: 'http://x/b' },
        { url: 'http://x/c' },
      ],
      fetchImpl: fakeFetch,
    });
    expect(hits.sort()).toEqual(['http://x/a', 'http://x/b', 'http://x/c']);
    expect(r.every(x => x.ok)).toBe(true);
  });

  it('marks slow URLs', async () => {
    // delay the fake fetch so elapsed > budget
    const fakeFetch: any = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 30));
      return new Response('', { status: 200 });
    });
    const r = await cacheWarm({
      targets: [{ url: 'http://x/slow', budgetMs: 5 }],
      fetchImpl: fakeFetch,
    });
    expect(r[0].slow).toBe(true);
    expect(r[0].ok).toBe(true);
  });

  it('marks failed URLs as not-ok but does not throw', async () => {
    const fakeFetch: any = vi.fn(async () => {
      throw new Error('connect-fail');
    });
    const r = await cacheWarm({
      targets: [{ url: 'http://x/dead' }],
      fetchImpl: fakeFetch,
    });
    expect(r[0].ok).toBe(false);
    expect(r[0].error).toContain('connect-fail');
  });

  it('marks 5xx as not-ok', async () => {
    const fakeFetch: any = vi.fn(async () => new Response('', { status: 500 }));
    const r = await cacheWarm({
      targets: [{ url: 'http://x/5xx' }],
      fetchImpl: fakeFetch,
    });
    expect(r[0].ok).toBe(false);
    expect(r[0].status).toBe(500);
  });

  it('respects concurrency cap', async () => {
    let inflight = 0;
    let maxInflight = 0;
    const fakeFetch: any = vi.fn(async () => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise(r => setTimeout(r, 20));
      inflight -= 1;
      return new Response('', { status: 200 });
    });
    const targets = Array.from({ length: 10 }, (_, i) => ({ url: `http://x/${i}` }));
    await cacheWarm({ targets, concurrency: 3, fetchImpl: fakeFetch });
    expect(maxInflight).toBeLessThanOrEqual(3);
  });

  it('honours per-target header overrides', async () => {
    let seen: any;
    const fakeFetch: any = vi.fn(async (_url: string, init: any) => {
      seen = init.headers;
      return new Response('', { status: 200 });
    });
    await cacheWarm({
      targets: [{ url: 'http://x', headers: { 'X-Test': '1' } }],
      fetchImpl: fakeFetch,
    });
    expect(seen['X-Test']).toBe('1');
    expect(seen['Accept-Encoding']).toContain('gzip');
  });

  it('returns one result per target even when some fail', async () => {
    let n = 0;
    const fakeFetch: any = vi.fn(async () => {
      n += 1;
      if (n === 2) throw new Error('boom');
      return new Response('', { status: 200 });
    });
    const r = await cacheWarm({
      targets: [
        { url: 'http://x/1' },
        { url: 'http://x/2' },
        { url: 'http://x/3' },
      ],
      concurrency: 1, // sequential so we hit n=2 deterministically
      fetchImpl: fakeFetch,
    });
    expect(r).toHaveLength(3);
    expect(r.filter(x => !x.ok)).toHaveLength(1);
  });
});
