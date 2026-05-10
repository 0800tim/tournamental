/**
 * swap.ts — atomic-ish slot swap.
 *
 * On the same filesystem, `rename(2)` is atomic at the directory-entry
 * level. We use it to flip prod ← staging in one syscall, with an
 * intermediate prev-slot kept for rollback.
 *
 * Sequence:
 *   1. if prod exists → mv prod prev (failing this aborts)
 *   2.                  mv staging prod
 *   3. write prev's BUILD_ID into rollback file (best-effort)
 *
 * If step 2 fails after step 1 succeeded, we attempt to restore prev → prod
 * before throwing.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { SlotPaths } from './build-slots.js';

export interface SwapResult {
  swapped: boolean;
  hadPrev: boolean;
  rollbackFile: string;
  /** Captured BUILD_ID from the new prod (if discoverable). */
  newBuildId?: string;
  /** Captured BUILD_ID of the previous build (now in prev slot). */
  prevBuildId?: string;
  durationMs: number;
}

export interface SwapFs {
  existsSync: (p: string) => boolean;
  rename: (from: string, to: string) => Promise<void>;
  rm: (target: string, opts?: { recursive?: boolean; force?: boolean }) => Promise<void>;
  readFile: (p: string) => Promise<string>;
  writeFile: (p: string, content: string) => Promise<void>;
  mkdir: (p: string, opts?: { recursive?: boolean }) => Promise<void>;
}

export interface SwapOptions {
  /** Where to write the rollback marker. Defaults to <appDir>/.deploy/rollback.json. */
  rollbackFilePath?: string;
  /** Test seam — replace fs ops in unit tests. */
  fsImpl?: SwapFs;
}

const realFs: SwapFs = {
  existsSync: (p: string) => fs.existsSync(p),
  rename: (from: string, to: string) => fsp.rename(from, to),
  rm: (target: string, opts?: { recursive?: boolean; force?: boolean }) =>
    fsp.rm(target, opts).then(() => undefined),
  readFile: (p: string) => fsp.readFile(p, 'utf8'),
  writeFile: (p: string, c: string) => fsp.writeFile(p, c, 'utf8'),
  mkdir: (p: string, opts?: { recursive?: boolean }) =>
    fsp.mkdir(p, opts).then(() => undefined),
};

async function readBuildId(slotDir: string, fsImpl: SwapFs): Promise<string | undefined> {
  // Next.js writes BUILD_ID at the top of the build dir.
  const candidate = path.join(slotDir, 'BUILD_ID');
  if (!fsImpl.existsSync(candidate)) return undefined;
  try {
    return (await fsImpl.readFile(candidate)).trim();
  } catch {
    return undefined;
  }
}

/**
 * Atomic-ish swap. The caller must have written the new build to slots.staging
 * already. After this returns successfully, prod runs from slots.prod and the
 * previous build (if any) is in slots.prev.
 *
 * Throws if slots.staging doesn't exist (no build was produced).
 */
export async function swap(
  slots: SlotPaths,
  appDir: string,
  options: SwapOptions = {},
): Promise<SwapResult> {
  const fsImpl = options.fsImpl ?? realFs;
  const rollbackFile =
    options.rollbackFilePath ?? path.join(appDir, '.deploy', 'rollback.json');

  if (!fsImpl.existsSync(slots.staging)) {
    throw new Error(
      `swap: staging slot does not exist (${slots.staging}). Did the build step run?`,
    );
  }

  const t0 = Date.now();

  const newBuildId = await readBuildId(slots.staging, fsImpl);
  const hadPrev = fsImpl.existsSync(slots.prod);
  let prevBuildId: string | undefined;
  if (hadPrev) {
    prevBuildId = await readBuildId(slots.prod, fsImpl);
  }

  // 1. clear out an existing prev slot (we keep only one previous build)
  if (fsImpl.existsSync(slots.prev)) {
    await fsImpl.rm(slots.prev, { recursive: true, force: true });
  }

  // 2. prod -> prev (only if prod existed)
  if (hadPrev) {
    await fsImpl.rename(slots.prod, slots.prev);
  }

  // 3. staging -> prod, with rollback on failure
  try {
    await fsImpl.rename(slots.staging, slots.prod);
  } catch (err) {
    // Restore prev → prod best-effort
    if (hadPrev && fsImpl.existsSync(slots.prev) && !fsImpl.existsSync(slots.prod)) {
      try {
        await fsImpl.rename(slots.prev, slots.prod);
      } catch {
        // swallow — original error matters more
      }
    }
    throw err;
  }

  // 4. write rollback marker (best-effort)
  try {
    await fsImpl.mkdir(path.dirname(rollbackFile), { recursive: true });
    await fsImpl.writeFile(
      rollbackFile,
      JSON.stringify(
        {
          ts: new Date().toISOString(),
          newBuildId,
          prevBuildId,
          prevSlot: slots.prev,
          prodSlot: slots.prod,
        },
        null,
        2,
      ),
    );
  } catch {
    // non-fatal
  }

  return {
    swapped: true,
    hadPrev,
    rollbackFile,
    newBuildId,
    prevBuildId,
    durationMs: Date.now() - t0,
  };
}

/**
 * Inverse of `swap()`. Used by `rollback.ts` and by `publish()`'s post-reload
 * verify path when the new build is failing 5xx in prod.
 *
 * Sequence:
 *   1. mv prod failed
 *   2. mv prev prod
 *
 * Throws if slots.prev doesn't exist (no rollback target).
 */
export async function rollbackSwap(
  slots: SlotPaths,
  options: SwapOptions = {},
): Promise<{ rolledBack: true; failedSlot: string; durationMs: number }> {
  const fsImpl = options.fsImpl ?? realFs;
  const t0 = Date.now();

  if (!fsImpl.existsSync(slots.prev)) {
    throw new Error(
      `rollbackSwap: no prev slot at ${slots.prev}. Cannot roll back.`,
    );
  }

  // clear stale failed slot
  if (fsImpl.existsSync(slots.failed)) {
    await fsImpl.rm(slots.failed, { recursive: true, force: true });
  }

  if (fsImpl.existsSync(slots.prod)) {
    await fsImpl.rename(slots.prod, slots.failed);
  }
  await fsImpl.rename(slots.prev, slots.prod);

  return { rolledBack: true, failedSlot: slots.failed, durationMs: Date.now() - t0 };
}
