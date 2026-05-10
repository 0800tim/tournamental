import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { CursorStore } from '../src/lib/cursors.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(resolve(tmpdir(), 'cursors-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('CursorStore', () => {
  it('returns undefined for unknown channels before set', async () => {
    const store = new CursorStore({ path: resolve(dir, 'cursors.jsonl') });
    await store.load();
    expect(store.get('reddit')).toBeUndefined();
    expect(store.snapshot()).toEqual({ reddit: null, mastodon: null, signal: null });
  });

  it('persists cursors across reload', async () => {
    const path = resolve(dir, 'cursors.jsonl');
    const a = new CursorStore({ path });
    await a.set('reddit', 't4_aaa');
    await a.set('mastodon', '{"mastodon.social":"42"}');
    const b = new CursorStore({ path });
    await b.load();
    expect(b.get('reddit')).toBe('t4_aaa');
    expect(b.get('mastodon')).toBe('{"mastodon.social":"42"}');
    expect(b.get('signal')).toBeUndefined();
  });

  it('latest write wins on reload (append-only semantics)', async () => {
    const path = resolve(dir, 'cursors.jsonl');
    const a = new CursorStore({ path });
    await a.set('reddit', 't4_old');
    await a.set('reddit', 't4_new');
    const raw = await fs.readFile(path, 'utf8');
    expect(raw.split('\n').filter(Boolean)).toHaveLength(2);
    const b = new CursorStore({ path });
    await b.load();
    expect(b.get('reddit')).toBe('t4_new');
  });

  it('compacts when file exceeds threshold', async () => {
    const path = resolve(dir, 'cursors.jsonl');
    const store = new CursorStore({ path, compactIfLargerThanBytes: 200 });
    for (let i = 0; i < 30; i += 1) {
      await store.set('reddit', `t4_${'x'.repeat(20)}_${i}`);
    }
    const raw = await fs.readFile(path, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    // After compaction the file should be tiny — one line per known channel.
    expect(lines.length).toBeLessThanOrEqual(3);
    const fresh = new CursorStore({ path });
    await fresh.load();
    expect(fresh.get('reddit')).toBe(`t4_${'x'.repeat(20)}_29`);
  });

  it('skips malformed lines on load', async () => {
    const path = resolve(dir, 'cursors.jsonl');
    await fs.writeFile(
      path,
      '{not json\n' + JSON.stringify({ channel: 'reddit', cursor: 'good', ts: 1 }) + '\n',
    );
    const store = new CursorStore({ path });
    await store.load();
    expect(store.get('reddit')).toBe('good');
  });
});
