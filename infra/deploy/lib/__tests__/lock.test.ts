import { describe, it, expect, beforeEach } from 'vitest';
import { acquireLock } from '../lock.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtorn-lock-test-'));
});

describe('acquireLock', () => {
  it('acquires a fresh lock', async () => {
    const lockPath = path.join(tmpDir, 'a.lock');
    const lock = await acquireLock({ path: lockPath });
    expect(fs.existsSync(lockPath)).toBe(true);
    expect(lock.pid).toBe(process.pid);
    await lock.release();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('rejects when held by an alive process and waitMs=0', async () => {
    const lockPath = path.join(tmpDir, 'a.lock');
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 1, ts: 'now' }));
    await expect(
      acquireLock({
        path: lockPath,
        waitMs: 0,
        pidAlive: () => true,
      }),
    ).rejects.toThrow(/lock held/);
  });

  it('steals a stale lock (pid dead)', async () => {
    const lockPath = path.join(tmpDir, 'a.lock');
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 99999999, ts: 'old' }));
    const lock = await acquireLock({
      path: lockPath,
      pidAlive: () => false,
    });
    expect(lock.pid).toBe(process.pid);
    await lock.release();
  });

  it('does not steal when stealStale=false', async () => {
    const lockPath = path.join(tmpDir, 'a.lock');
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 99999999, ts: 'old' }));
    await expect(
      acquireLock({
        path: lockPath,
        waitMs: 0,
        stealStale: false,
        pidAlive: () => false,
      }),
    ).rejects.toThrow(/lock held/);
  });

  it('waits and retries until lock is freed', async () => {
    const lockPath = path.join(tmpDir, 'a.lock');
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 1, ts: 'now' }));
    setTimeout(() => fs.unlinkSync(lockPath), 200);
    const lock = await acquireLock({
      path: lockPath,
      waitMs: 2000,
      pidAlive: () => true,
    });
    expect(lock.pid).toBe(process.pid);
    await lock.release();
  });

  it('release is idempotent', async () => {
    const lockPath = path.join(tmpDir, 'a.lock');
    const lock = await acquireLock({ path: lockPath });
    await lock.release();
    await expect(lock.release()).resolves.toBeUndefined();
  });

  it('creates the lock dir if it does not exist', async () => {
    const lockPath = path.join(tmpDir, 'sub', 'dir', 'a.lock');
    const lock = await acquireLock({ path: lockPath });
    expect(fs.existsSync(lockPath)).toBe(true);
    await lock.release();
  });

  it('does not steal an unreadable lock file', async () => {
    const lockPath = path.join(tmpDir, 'a.lock');
    fs.writeFileSync(lockPath, 'not-json');
    await expect(
      acquireLock({
        path: lockPath,
        waitMs: 0,
        pidAlive: () => false,
      }),
    ).rejects.toThrow(/lock held/);
  });
});
