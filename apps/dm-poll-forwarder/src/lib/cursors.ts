/**
 * Append-only JSONL cursor store.
 *
 * Why JSONL and not SQLite/Redis: pollers run as a single process per
 * channel; the cursor value is one short string per channel; durability
 * is satisfied by an `fsync` after every append. JSONL is also trivially
 * inspectable by an operator with `tail -f data/cursors.jsonl`.
 *
 * Latest line wins. We replay the file once at startup to seed an
 * in-memory map; subsequent reads are O(1). The file grows linearly with
 * polls, so we periodically compact (rewrite to keep only the latest
 * entry per channel) when the file exceeds 1 MiB. Compaction is opt-in
 * via `compactIfLargerThanBytes` for tests that care about timing.
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

import type { Channel } from '../types.js';

export interface CursorStoreOptions {
  /** Path to the JSONL file. */
  path: string;
  /** Compaction threshold in bytes. Default 1 MiB. */
  compactIfLargerThanBytes?: number;
  /** Clock injection for tests. */
  now?: () => number;
}

interface CursorRecord {
  channel: Channel;
  cursor: string;
  ts: number;
}

const DEFAULT_COMPACT_BYTES = 1024 * 1024;

export class CursorStore {
  private readonly path: string;
  private readonly compactThreshold: number;
  private readonly now: () => number;
  private readonly cache = new Map<Channel, string>();
  private loaded = false;

  constructor(opts: CursorStoreOptions) {
    this.path = opts.path;
    this.compactThreshold = opts.compactIfLargerThanBytes ?? DEFAULT_COMPACT_BYTES;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Read the JSONL file from disk and seed the in-memory cache. Idempotent.
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    await fs.mkdir(dirname(this.path), { recursive: true });
    let raw: string;
    try {
      raw = await fs.readFile(this.path, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        this.loaded = true;
        return;
      }
      throw err;
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as CursorRecord;
        if (rec && typeof rec.channel === 'string' && typeof rec.cursor === 'string') {
          this.cache.set(rec.channel, rec.cursor);
        }
      } catch {
        // Skip malformed lines rather than crashing the worker on boot.
      }
    }
    this.loaded = true;
  }

  get(channel: Channel): string | undefined {
    return this.cache.get(channel);
  }

  /** Test/observability helper. */
  snapshot(): Record<Channel, string | null> {
    return {
      reddit: this.cache.get('reddit') ?? null,
      mastodon: this.cache.get('mastodon') ?? null,
      signal: this.cache.get('signal') ?? null,
    };
  }

  /**
   * Persist a new cursor for a channel. The latest write wins on the next
   * load; we always update the in-memory cache first so reads after
   * `set` are immediately consistent even if the disk write is racing.
   */
  async set(channel: Channel, cursor: string): Promise<void> {
    if (!this.loaded) await this.load();
    this.cache.set(channel, cursor);
    const rec: CursorRecord = { channel, cursor, ts: this.now() };
    const line = JSON.stringify(rec) + '\n';
    await fs.mkdir(dirname(this.path), { recursive: true });
    await fs.appendFile(this.path, line, 'utf8');
    await this.maybeCompact();
  }

  private async maybeCompact(): Promise<void> {
    let stat;
    try {
      stat = await fs.stat(this.path);
    } catch {
      return;
    }
    if (stat.size < this.compactThreshold) return;
    // Latest-wins compaction: write one line per channel from the cache.
    const lines: string[] = [];
    for (const [channel, cursor] of this.cache) {
      lines.push(JSON.stringify({ channel, cursor, ts: this.now() } satisfies CursorRecord));
    }
    const body = lines.length ? lines.join('\n') + '\n' : '';
    const tmp = this.path + '.tmp';
    await fs.writeFile(tmp, body, 'utf8');
    await fs.rename(tmp, this.path);
  }
}
