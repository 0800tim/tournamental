/**
 * NewsStore round-trip + filter coverage.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NewsStore } from '../src/lib/store.js';
import type { NewsItem } from '../src/types.js';

function mkItem(overrides: Partial<NewsItem>): NewsItem {
  return {
    id: 'stub-00000001',
    title: 'Title',
    summary: 'Summary',
    url: 'https://example.com/article',
    source: 'Stub',
    publishedAt: new Date().toISOString(),
    language: 'en',
    tags: ['football'],
    ...overrides,
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'news-store-'));
});

describe('NewsStore', () => {
  it('round-trips through the JSONL cache', async () => {
    const path = join(dir, 'cache.jsonl');
    const a = new NewsStore({ cachePath: path });
    await a.insertMany([
      mkItem({ id: 'a-1', publishedAt: '2026-05-11T10:00:00.000Z' }),
      mkItem({ id: 'a-2', publishedAt: '2026-05-11T11:00:00.000Z' }),
    ]);
    expect(a.size()).toBe(2);
    expect(existsSync(path)).toBe(true);

    const b = new NewsStore({ cachePath: path });
    const loaded = await b.load();
    expect(loaded).toBe(2);
    expect(b.size()).toBe(2);
    expect(b.byId('a-1')).not.toBeNull();
  });

  it('latest-wins on duplicate id', async () => {
    const path = join(dir, 'cache.jsonl');
    const s = new NewsStore({ cachePath: path });
    await s.insertMany([mkItem({ id: 'dup', title: 'old', publishedAt: '2026-05-11T10:00:00.000Z' })]);
    await s.insertMany([mkItem({ id: 'dup', title: 'new', publishedAt: '2026-05-11T11:00:00.000Z' })]);
    expect(s.byId('dup')!.title).toBe('new');
  });

  it('does not regress on older duplicate publishedAt', async () => {
    const path = join(dir, 'cache.jsonl');
    const s = new NewsStore({ cachePath: path });
    await s.insertMany([mkItem({ id: 'dup', title: 'new', publishedAt: '2026-05-11T11:00:00.000Z' })]);
    await s.insertMany([mkItem({ id: 'dup', title: 'old', publishedAt: '2026-05-11T10:00:00.000Z' })]);
    expect(s.byId('dup')!.title).toBe('new');
  });

  it('skips items beyond retention', async () => {
    const path = join(dir, 'cache.jsonl');
    const s = new NewsStore({ cachePath: path, retentionDays: 1 });
    const ancient = new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString();
    const fresh = new Date(Date.now() - 1000 * 60).toISOString();
    const added = await s.insertMany([
      mkItem({ id: 'old', publishedAt: ancient }),
      mkItem({ id: 'new', publishedAt: fresh }),
    ]);
    expect(added).toBe(1);
    expect(s.byId('old')).toBeNull();
    expect(s.byId('new')).not.toBeNull();
  });

  it('query: defaults newest-first and respects limit', async () => {
    const path = join(dir, 'cache.jsonl');
    const s = new NewsStore({ cachePath: path });
    await s.insertMany([
      mkItem({ id: '1', publishedAt: '2026-05-09T00:00:00.000Z' }),
      mkItem({ id: '2', publishedAt: '2026-05-10T00:00:00.000Z' }),
      mkItem({ id: '3', publishedAt: '2026-05-11T00:00:00.000Z' }),
    ]);
    const r = s.query({ limit: 2 });
    expect(r.map((i) => i.id)).toEqual(['3', '2']);
  });

  it('query: filters by since', async () => {
    const path = join(dir, 'cache.jsonl');
    const s = new NewsStore({ cachePath: path });
    await s.insertMany([
      mkItem({ id: '1', publishedAt: '2026-05-09T00:00:00.000Z' }),
      mkItem({ id: '2', publishedAt: '2026-05-10T00:00:00.000Z' }),
      mkItem({ id: '3', publishedAt: '2026-05-11T00:00:00.000Z' }),
    ]);
    const r = s.query({ since: '2026-05-10T00:00:00.000Z' });
    expect(r.map((i) => i.id)).toEqual(['3']);
  });

  it('query: filters by source name (case-insensitive)', async () => {
    const path = join(dir, 'cache.jsonl');
    const s = new NewsStore({ cachePath: path });
    await s.insertMany([
      mkItem({ id: 'a', source: 'BBC Sport' }),
      mkItem({ id: 'b', source: 'ESPN' }),
    ]);
    expect(s.query({ source: 'bbc sport' }).map((i) => i.id)).toEqual(['a']);
  });

  it('query: filters by language', async () => {
    const path = join(dir, 'cache.jsonl');
    const s = new NewsStore({ cachePath: path });
    await s.insertMany([
      mkItem({ id: 'a', language: 'en' }),
      mkItem({ id: 'b', language: 'es' }),
    ]);
    expect(s.query({ lang: 'es' }).map((i) => i.id)).toEqual(['b']);
    // lang=any escape hatch
    expect(s.query({ lang: 'any' }).length).toBe(2);
  });

  it('query: filters by tag', async () => {
    const path = join(dir, 'cache.jsonl');
    const s = new NewsStore({ cachePath: path });
    await s.insertMany([
      mkItem({ id: 'a', tags: ['football', 'wc2026'] }),
      mkItem({ id: 'b', tags: ['football'] }),
    ]);
    expect(s.query({ tag: 'wc2026' }).map((i) => i.id)).toEqual(['a']);
  });

  it('latestPublishedAt tracks the newest publish time', async () => {
    const path = join(dir, 'cache.jsonl');
    const s = new NewsStore({ cachePath: path });
    await s.insertMany([
      mkItem({ id: '1', publishedAt: '2026-05-09T00:00:00.000Z' }),
      mkItem({ id: '2', publishedAt: '2026-05-11T00:00:00.000Z' }),
    ]);
    expect(s.getLatestPublishedAt()).toBe('2026-05-11T00:00:00.000Z');
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });
});
