import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuditLog } from '../src/lib/audit-log.js';
import type { PostRecord } from '../src/types.js';

describe('AuditLog', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'social-publisher-test-'));
    path = join(dir, 'posts.jsonl');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function rec(overrides: Partial<PostRecord> = {}): PostRecord {
    return {
      ts: 1_715_000_000_000,
      platform: 'x',
      externalId: 'abc123def456',
      url: 'https://x.com/vtorn/status/abc123def456',
      clipId: 'clip_test_001',
      eventType: 'goal',
      status: 'published',
      tournamentId: 'fifa-wc-2022',
      matchId: 'fifa-wc-2022-final-arg-fra',
      ...overrides,
    };
  }

  it('returns [] when the file does not exist', async () => {
    const log = new AuditLog(path);
    expect(await log.readAll()).toEqual([]);
  });

  it('appends and reads back a single record', async () => {
    const log = new AuditLog(path);
    await log.append(rec());
    const all = await log.readAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.platform).toBe('x');
    expect(all[0]?.externalId).toBe('abc123def456');
  });

  it('preserves order across many appends', async () => {
    const log = new AuditLog(path);
    for (let i = 0; i < 5; i++) {
      await log.append(rec({ externalId: `id${i}`, ts: 1_715_000_000_000 + i }));
    }
    const all = await log.readAll();
    expect(all.map((r) => r.externalId)).toEqual(['id0', 'id1', 'id2', 'id3', 'id4']);
  });

  it('creates the parent directory if it does not exist', async () => {
    const nested = join(dir, 'a', 'b', 'c', 'posts.jsonl');
    const log = new AuditLog(nested);
    await log.append(rec());
    const all = await log.readAll();
    expect(all).toHaveLength(1);
  });

  it('skips a corrupt trailing line gracefully', async () => {
    const log = new AuditLog(path);
    await log.append(rec({ externalId: 'good1' }));
    // Manually append a malformed line
    const { appendFile } = await import('node:fs/promises');
    await appendFile(path, '{not valid json\n', 'utf8');
    await log.append(rec({ externalId: 'good2' }));
    const all = await log.readAll();
    expect(all.map((r) => r.externalId)).toEqual(['good1', 'good2']);
  });
});
