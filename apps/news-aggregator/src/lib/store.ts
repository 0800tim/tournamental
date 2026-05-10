/**
 * In-memory index + JSONL append cache.
 *
 * The hot path is `query()` (the public API). Reads are O(items) over a
 * pre-sorted in-memory array — fine for the few-thousand-item ceiling
 * we'll ever hold (sources rarely emit > 100 items per poll, we keep
 * 30 days, that's ~50k rows worst case).
 *
 * The JSONL file is append-only for crash-recovery. On boot we replay
 * it and rebuild the in-memory map. Latest-wins on duplicate id (by
 * publishedAt then by replay order).
 */
import { mkdir, appendFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

import type { NewsItem } from '../types.js';

export interface StoreOptions {
  readonly cachePath: string;
  /** Drop items older than this many days on load + on insert. */
  readonly retentionDays?: number;
  /** Inject for tests. Defaults to fs-backed implementations. */
  readonly fs?: {
    readFile?: typeof readFile;
    writeFile?: typeof writeFile;
    appendFile?: typeof appendFile;
    mkdir?: typeof mkdir;
    existsSync?: typeof existsSync;
  };
}

export interface QueryOptions {
  readonly limit?: number;
  readonly since?: string;
  readonly source?: string;
  readonly lang?: string;
  readonly tag?: string;
}

export class NewsStore {
  private readonly items = new Map<string, NewsItem>();
  private readonly cachePath: string;
  private readonly retentionMs: number;
  private readonly _fs: Required<NonNullable<StoreOptions['fs']>>;
  private latestPublishedAt = '';

  constructor(opts: StoreOptions) {
    this.cachePath = opts.cachePath;
    this.retentionMs = (opts.retentionDays ?? 30) * 24 * 60 * 60 * 1000;
    this._fs = {
      readFile: opts.fs?.readFile ?? readFile,
      writeFile: opts.fs?.writeFile ?? writeFile,
      appendFile: opts.fs?.appendFile ?? appendFile,
      mkdir: opts.fs?.mkdir ?? mkdir,
      existsSync: opts.fs?.existsSync ?? existsSync,
    };
  }

  size(): number {
    return this.items.size;
  }

  getLatestPublishedAt(): string {
    return this.latestPublishedAt;
  }

  async load(): Promise<number> {
    if (!this._fs.existsSync(this.cachePath)) return 0;
    const raw = await this._fs.readFile(this.cachePath, 'utf8');
    let parsed = 0;
    const cutoff = Date.now() - this.retentionMs;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as NewsItem;
        if (Date.parse(obj.publishedAt) < cutoff) continue;
        this.items.set(obj.id, obj);
        if (obj.publishedAt > this.latestPublishedAt) this.latestPublishedAt = obj.publishedAt;
        parsed++;
      } catch {
        // Skip malformed lines — JSONL is append-only so a partial
        // tail line is normal after a crash.
      }
    }
    return parsed;
  }

  /**
   * Insert a batch of items. Returns the count of newly-inserted items
   * (i.e. ids we hadn't seen before; updates don't count).
   */
  async insertMany(batch: readonly NewsItem[]): Promise<number> {
    if (batch.length === 0) return 0;
    await this._fs.mkdir(dirname(this.cachePath), { recursive: true });
    const cutoff = Date.now() - this.retentionMs;
    const fresh: NewsItem[] = [];
    let added = 0;
    for (const item of batch) {
      if (Date.parse(item.publishedAt) < cutoff) continue;
      const existing = this.items.get(item.id);
      // Latest-wins on duplicate id (later publishedAt or, if equal,
      // later observation).
      if (existing && existing.publishedAt >= item.publishedAt) continue;
      if (!existing) added++;
      this.items.set(item.id, item);
      if (item.publishedAt > this.latestPublishedAt) this.latestPublishedAt = item.publishedAt;
      fresh.push(item);
    }
    if (fresh.length > 0) {
      const lines = fresh.map((i) => JSON.stringify(i)).join('\n') + '\n';
      await this._fs.appendFile(this.cachePath, lines, 'utf8');
    }
    return added;
  }

  query(opts: QueryOptions = {}): readonly NewsItem[] {
    const limit = Math.max(1, Math.min(100, opts.limit ?? 20));
    const lang = opts.lang ?? 'en';
    const sinceMs = opts.since ? Date.parse(opts.since) : Number.NEGATIVE_INFINITY;
    const sourceMatch = opts.source ? opts.source.toLowerCase() : null;
    const tagMatch = opts.tag ? opts.tag.toLowerCase() : null;

    const all = [...this.items.values()].filter((it) => {
      if (it.language !== lang && lang !== 'any') return false;
      if (sinceMs && Date.parse(it.publishedAt) <= sinceMs) return false;
      if (sourceMatch && it.source.toLowerCase() !== sourceMatch) return false;
      if (tagMatch && !it.tags.some((t) => t.toLowerCase() === tagMatch)) return false;
      return true;
    });

    all.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0));
    return all.slice(0, limit);
  }

  byId(id: string): NewsItem | null {
    return this.items.get(id) ?? null;
  }

  /**
   * Used by tests to drop everything (memory + disk).
   */
  async clear(): Promise<void> {
    this.items.clear();
    this.latestPublishedAt = '';
    await this._fs.writeFile(this.cachePath, '', 'utf8').catch(() => {});
  }
}
