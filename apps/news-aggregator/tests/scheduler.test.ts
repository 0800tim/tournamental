/**
 * Scheduler tests — concurrency-skip + tick-runs-fetch behaviour.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SourceFetcher } from '../src/lib/fetcher.js';
import { NewsStore } from '../src/lib/store.js';
import { Scheduler } from '../src/scheduler.js';
import { descriptor as bbc } from '../src/sources/bbc.js';
import { descriptor as theguardian } from '../src/sources/theguardian.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const bbcXml = readFileSync(resolve(here, 'fixtures/bbc.xml'), 'utf8');
const guardianXml = readFileSync(resolve(here, 'fixtures/theguardian.xml'), 'utf8');

const stubLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => stubLogger,
  level: 'info',
} as unknown as Parameters<typeof Scheduler.prototype.constructor>[0]['logger'];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scheduler-'));
});
afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});

describe('Scheduler', () => {
  it('a single tick fetches enabled sources and writes to the store', async () => {
    const fetcher = new SourceFetcher({
      fetcher: (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === bbc.feedUrl) return new Response(bbcXml, { status: 200 });
        if (url === theguardian.feedUrl) return new Response(guardianXml, { status: 200 });
        return new Response('', { status: 404 });
      }) as unknown as typeof fetch,
    });
    const store = new NewsStore({ cachePath: join(dir, 'cache.jsonl') });
    const sched = new Scheduler({ intervalMs: 60_000, fetcher, store, logger: stubLogger });
    const r = await sched.tick();
    expect(r.added).toBeGreaterThan(0);
    expect(store.size()).toBe(r.added);
    expect(sched.getLastRunAt()).not.toBeNull();
  });

  it('skips an overlapping tick while one is in flight', async () => {
    const pending: Array<(res: Response) => void> = [];
    const fetcher = new SourceFetcher({
      fetcher: (async () =>
        new Promise<Response>((resolve) => {
          pending.push(resolve);
        })) as unknown as typeof fetch,
    });
    const store = new NewsStore({ cachePath: join(dir, 'cache.jsonl') });
    const sched = new Scheduler({ intervalMs: 60_000, fetcher, store, logger: stubLogger });
    const inflight = sched.tick();
    // Yield until the first tick has actually fired its fetches.
    await new Promise((r) => setImmediate(r));
    const skipped = await sched.tick();
    expect(skipped.added).toBe(0);
    // Resolve every pending fetch so the first tick can complete cleanly.
    for (const r of pending) r(new Response('', { status: 404 }));
    await inflight;
  }, 10_000);
});
