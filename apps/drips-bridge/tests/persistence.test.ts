import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContributorStore,
  DistributionStore,
} from '../src/lib/contributors.js';

describe('ContributorStore JSONL persistence', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'drips-contrib-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips inserts via JSONL replay', () => {
    const path = join(dir, 'c.jsonl');
    const a = new ContributorStore({ path });
    const reg = a.register({ githubLogin: 'alice', activeShares: 50 });
    a.register({ githubLogin: 'bob', activeShares: 25 });

    const b = new ContributorStore({ path });
    expect(b.count()).toBe(2);
    expect(b.get(reg.contributor.id)?.githubLogin).toBe('alice');
    expect(b.getByLogin('bob')?.activeShares).toBe(25);
  });

  it('round-trips patches via JSONL replay', () => {
    const path = join(dir, 'c.jsonl');
    const a = new ContributorStore({ path });
    const reg = a.register({ githubLogin: 'alice' });
    a.update(reg.contributor.id, { activeShares: 999, role: 'founder' });

    const b = new ContributorStore({ path });
    const replayed = b.get(reg.contributor.id)!;
    expect(replayed.activeShares).toBe(999);
    expect(replayed.role).toBe('founder');
  });

  it('writes one line per record', () => {
    const path = join(dir, 'c.jsonl');
    const a = new ContributorStore({ path });
    a.register({ githubLogin: 'alice' });
    a.register({ githubLogin: 'bob' });
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.op).toBe('insert');
    }
  });

  it('survives a corrupt line by skipping it', () => {
    const path = join(dir, 'c.jsonl');
    const a = new ContributorStore({ path });
    a.register({ githubLogin: 'alice' });
    // Inject a corrupt line.
    const fs = require('node:fs');
    fs.appendFileSync(path, 'not-json\n');
    a.register({ githubLogin: 'bob' });

    const b = new ContributorStore({ path });
    expect(b.count()).toBe(2);
    expect(b.getByLogin('alice')).toBeDefined();
    expect(b.getByLogin('bob')).toBeDefined();
  });
});

describe('DistributionStore JSONL persistence', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'drips-dist-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a full distribution lifecycle', () => {
    const path = join(dir, 'd.jsonl');
    const a = new DistributionStore({ path });
    const d = a.create({
      period: '2026-05',
      totalReceiptsUsd: 100,
      splits: [{ contributorId: 'c_a', sharesAtSnapshot: 1, payoutUsd: 100 }],
    });
    a.setStatus(d.id, 'pushed', { txHash: '0xabc' });

    const b = new DistributionStore({ path });
    const loaded = b.get(d.id)!;
    expect(loaded.status).toBe('pushed');
    expect(loaded.txHash).toBe('0xabc');
    expect(loaded.totalReceiptsUsd).toBe(100);
  });

  it('preserves splits when status update does not pass new splits', () => {
    const path = join(dir, 'd.jsonl');
    const a = new DistributionStore({ path });
    const d = a.create({
      period: '2026-05',
      totalReceiptsUsd: 100,
      splits: [{ contributorId: 'c_a', sharesAtSnapshot: 1, payoutUsd: 100 }],
    });
    a.setStatus(d.id, 'confirmed');
    const reloaded = new DistributionStore({ path }).get(d.id)!;
    expect(reloaded.splits).toHaveLength(1);
    expect(reloaded.status).toBe('confirmed');
  });
});
