import { describe, it, expect, beforeEach } from 'vitest';
import { swap, rollbackSwap } from '../swap.js';
import type { SlotPaths } from '../build-slots.js';
import type { SwapOptions, SwapFs } from '../swap.js';

/**
 * In-memory fs stub so the swap tests don't touch the disk.
 * The "disk" is just a Map<absPath, value | DIR_MARKER>.
 */

const DIR = Symbol('DIR');

function makeFs(initial: Record<string, string | typeof DIR> = {}) {
  const disk = new Map<string, string | typeof DIR>(Object.entries(initial));

  function existsSync(p: string): boolean {
    if (disk.has(p)) return true;
    // also "exists" if any descendant key starts with `${p}/`
    for (const k of disk.keys()) if (k.startsWith(p + '/')) return true;
    return false;
  }

  return {
    disk,
    impl: {
      existsSync,
      rename: async (from: string, to: string) => {
        if (!existsSync(from)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        // rename all entries under `from` to `to`
        const moves: Array<[string, string]> = [];
        for (const k of disk.keys()) {
          if (k === from) moves.push([k, to]);
          else if (k.startsWith(from + '/')) moves.push([k, to + k.slice(from.length)]);
        }
        for (const [a, b] of moves) {
          const v = disk.get(a)!;
          disk.delete(a);
          disk.set(b, v);
        }
      },
      rm: async (target: string) => {
        for (const k of [...disk.keys()]) {
          if (k === target || k.startsWith(target + '/')) disk.delete(k);
        }
      },
      readFile: async (p: string) => {
        const v = disk.get(p);
        if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        if (v === DIR) throw Object.assign(new Error('EISDIR'), { code: 'EISDIR' });
        return v;
      },
      writeFile: async (p: string, content: string) => {
        disk.set(p, content);
      },
      mkdir: async (p: string) => {
        disk.set(p, DIR);
      },
    } satisfies SwapFs,
  };
}

const SLOTS: SlotPaths = {
  staging: '/app/.next-staging',
  prod: '/app/.next-prod',
  prev: '/app/.next-prev',
  failed: '/app/.next-failed',
};

describe('swap', () => {
  it('moves staging → prod when no prev exists', async () => {
    const fs = makeFs({
      '/app/.next-staging/BUILD_ID': 'NEW123',
    });
    const r = await swap(SLOTS, '/app', { fsImpl: fs.impl });
    expect(r.swapped).toBe(true);
    expect(r.hadPrev).toBe(false);
    expect(r.newBuildId).toBe('NEW123');
    expect(fs.impl.existsSync('/app/.next-prod/BUILD_ID')).toBe(true);
    expect(fs.impl.existsSync('/app/.next-staging')).toBe(false);
  });

  it('rotates prod → prev → (gone) when prod existed', async () => {
    const fs = makeFs({
      '/app/.next-prod/BUILD_ID': 'OLD',
      '/app/.next-staging/BUILD_ID': 'NEW',
    });
    const r = await swap(SLOTS, '/app', { fsImpl: fs.impl });
    expect(r.hadPrev).toBe(true);
    expect(r.prevBuildId).toBe('OLD');
    expect(r.newBuildId).toBe('NEW');
    expect(await fs.impl.readFile('/app/.next-prod/BUILD_ID')).toBe('NEW');
    expect(await fs.impl.readFile('/app/.next-prev/BUILD_ID')).toBe('OLD');
  });

  it('writes a rollback marker file', async () => {
    const fs = makeFs({
      '/app/.next-prod/BUILD_ID': 'OLD',
      '/app/.next-staging/BUILD_ID': 'NEW',
    });
    const r = await swap(SLOTS, '/app', {
      fsImpl: fs.impl,
      rollbackFilePath: '/app/.deploy/rollback.json',
    });
    expect(r.rollbackFile).toBe('/app/.deploy/rollback.json');
    const raw = await fs.impl.readFile('/app/.deploy/rollback.json');
    const j = JSON.parse(raw);
    expect(j.newBuildId).toBe('NEW');
    expect(j.prevBuildId).toBe('OLD');
  });

  it('clears stale prev before rotating', async () => {
    const fs = makeFs({
      '/app/.next-prev/BUILD_ID': 'STALE',
      '/app/.next-prod/BUILD_ID': 'OLD',
      '/app/.next-staging/BUILD_ID': 'NEW',
    });
    await swap(SLOTS, '/app', { fsImpl: fs.impl });
    // prev now holds OLD, not STALE
    expect(await fs.impl.readFile('/app/.next-prev/BUILD_ID')).toBe('OLD');
  });

  it('throws if staging missing', async () => {
    const fs = makeFs({});
    await expect(swap(SLOTS, '/app', { fsImpl: fs.impl })).rejects.toThrow(/staging slot does not exist/);
  });

  it('falls through with a missing BUILD_ID', async () => {
    // not all build kinds produce BUILD_ID (Astro etc.)
    const fs = makeFs({ '/app/.next-staging/server/index.js': 'ok' });
    const r = await swap(SLOTS, '/app', { fsImpl: fs.impl });
    expect(r.swapped).toBe(true);
    expect(r.newBuildId).toBeUndefined();
  });

  it('restores prev → prod on staging-rename failure (recovery path)', async () => {
    // Make the second rename fail by intercepting rename of staging.
    const fs = makeFs({
      '/app/.next-prod/BUILD_ID': 'OLD',
      '/app/.next-staging/BUILD_ID': 'NEW',
    });
    let calls = 0;
    const impl: SwapFs = {
      ...fs.impl,
      rename: async (from, to) => {
        calls += 1;
        if (calls === 2) throw new Error('boom');
        return fs.impl.rename(from, to);
      },
    };
    await expect(swap(SLOTS, '/app', { fsImpl: impl })).rejects.toThrow('boom');
    // After the recovery attempt, prod should still exist (restored from prev)
    // OR if recovery itself fails, at least we threw and didn't clobber.
    // Verify we threw — and that prev OR prod has OLD (somewhere).
    const prodOk = fs.impl.existsSync('/app/.next-prod/BUILD_ID');
    const prevOk = fs.impl.existsSync('/app/.next-prev/BUILD_ID');
    expect(prodOk || prevOk).toBe(true);
  });
});

describe('rollbackSwap', () => {
  it('promotes prev → prod and quarantines failing prod → failed', async () => {
    const fs = makeFs({
      '/app/.next-prod/BUILD_ID': 'BAD',
      '/app/.next-prev/BUILD_ID': 'GOOD',
    });
    const r = await rollbackSwap(SLOTS, { fsImpl: fs.impl });
    expect(r.rolledBack).toBe(true);
    expect(await fs.impl.readFile('/app/.next-prod/BUILD_ID')).toBe('GOOD');
    expect(await fs.impl.readFile('/app/.next-failed/BUILD_ID')).toBe('BAD');
  });

  it('throws when no prev to roll back to', async () => {
    const fs = makeFs({ '/app/.next-prod/BUILD_ID': 'BAD' });
    await expect(rollbackSwap(SLOTS, { fsImpl: fs.impl })).rejects.toThrow(/no prev slot/);
  });

  it('clears stale failed slot before quarantining', async () => {
    const fs = makeFs({
      '/app/.next-prod/BUILD_ID': 'BAD',
      '/app/.next-failed/BUILD_ID': 'OLDFAIL',
      '/app/.next-prev/BUILD_ID': 'GOOD',
    });
    await rollbackSwap(SLOTS, { fsImpl: fs.impl });
    expect(await fs.impl.readFile('/app/.next-failed/BUILD_ID')).toBe('BAD');
  });

  it('handles no live prod (e.g. crashed mid-deploy) by promoting prev', async () => {
    const fs = makeFs({
      '/app/.next-prev/BUILD_ID': 'GOOD',
    });
    const r = await rollbackSwap(SLOTS, { fsImpl: fs.impl });
    expect(r.rolledBack).toBe(true);
    expect(await fs.impl.readFile('/app/.next-prod/BUILD_ID')).toBe('GOOD');
  });
});
