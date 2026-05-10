/**
 * lock.ts — file-based deploy lock.
 *
 * Prevents two deploys to the same app from racing. Uses `O_EXCL | O_CREAT`
 * so the lock file's existence IS the lock. Stale-lock detection: if the
 * file's PID is dead, we steal the lock.
 *
 * Single-host only — for multi-host we'd want consul/etcd. That's deferred.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface LockOptions {
  /** Path to the lock file. */
  path: string;
  /** Time to wait for the lock before giving up. Default 0 (fail immediately). */
  waitMs?: number;
  /**
   * If a stale lock is found (PID dead), steal it. Default true.
   */
  stealStale?: boolean;
  /** Test seam. */
  pidAlive?: (pid: number) => boolean;
  /** Test seam — clock for retry loops. */
  now?: () => number;
}

export interface AcquiredLock {
  release(): Promise<void>;
  /** Path to the lock file. */
  path: string;
  /** PID written into the lock file (this process). */
  pid: number;
}

function defaultPidAlive(pid: number): boolean {
  try {
    // signal 0 = error if process doesn't exist
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means it exists but we can't signal it (still alive)
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Acquire the lock. Throws if the lock is held and waitMs is exhausted
 * (or zero). Returns an `AcquiredLock` whose `release()` removes the file.
 */
export async function acquireLock(opts: LockOptions): Promise<AcquiredLock> {
  const waitMs = opts.waitMs ?? 0;
  const stealStale = opts.stealStale ?? true;
  const pidAlive = opts.pidAlive ?? defaultPidAlive;
  const clock = opts.now ?? (() => Date.now());

  const dir = path.dirname(opts.path);
  await fs.promises.mkdir(dir, { recursive: true });

  const start = clock();
  while (true) {
    try {
      const fd = fs.openSync(opts.path, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o644);
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
      fs.closeSync(fd);
      return {
        path: opts.path,
        pid: process.pid,
        release: async () => {
          try {
            await fs.promises.unlink(opts.path);
          } catch {
            // already gone — fine
          }
        },
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw err;

      // Lock exists. Check staleness.
      let staleStolen = false;
      if (stealStale) {
        try {
          const raw = await fs.promises.readFile(opts.path, 'utf8');
          const parsed = JSON.parse(raw) as { pid?: unknown; ts?: unknown };
          const heldPid = typeof parsed.pid === 'number' ? parsed.pid : NaN;
          if (Number.isFinite(heldPid) && !pidAlive(heldPid)) {
            // stale — steal
            await fs.promises.unlink(opts.path);
            staleStolen = true;
          }
        } catch {
          // Unreadable lock file — be conservative; don't steal.
        }
      }
      if (staleStolen) continue; // retry immediately

      if (clock() - start >= waitMs) {
        throw new Error(`acquireLock: lock held at ${opts.path}; not acquired within ${waitMs}ms`);
      }
      await new Promise(r => setTimeout(r, 250));
    }
  }
}
