/**
 * rollback.ts — `pnpm deploy:rollback <app>`.
 *
 * Reverses the most recent swap by promoting <slot>-prev → <slot>-prod and
 * relegating the failing <slot>-prod → <slot>-failed. PM2 reload follows.
 *
 * If <slot>-prev doesn't exist, we have nothing to roll back to — the
 * caller must rebuild from a previous commit.
 */

import { rollbackSwap } from './swap.js';
import { reloadOrRestart } from './pm2.js';
import { slotPaths, type BuildKind } from './build-slots.js';
import { TimingsRecorder } from './timings.js';

export interface RollbackOptions {
  app: string;
  appDir: string;
  buildKind: BuildKind;
  pm2Name: string;
  ecosystemFile: string;
  /** repo root used for the timings JSONL location. */
  repoRoot: string;
  log?: (line: string) => void;
}

export interface RollbackResult {
  ok: boolean;
  failedSlot?: string;
  durationMs: number;
}

export async function rollback(opts: RollbackOptions): Promise<RollbackResult> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const rec = new TimingsRecorder(opts.app, 'production', { repoRoot: opts.repoRoot });
  const slots = slotPaths({ kind: opts.buildKind, appDir: opts.appDir });

  try {
    const swapResult = await rec.step('swap-back', () => rollbackSwap(slots));
    log(`[rollback] prev → prod swapped (${swapResult.durationMs}ms)`);

    const pm2Result = await rec.step('pm2', () =>
      reloadOrRestart({
        name: opts.pm2Name,
        ecosystemFile: opts.ecosystemFile,
        log,
      }),
    );
    log(`[rollback] pm2 ${pm2Result.action} (${pm2Result.durationMs}ms)`);

    const t = await rec.finalise('rolled-back', {
      notes: `failedSlot=${swapResult.failedSlot}`,
    });
    return { ok: true, failedSlot: swapResult.failedSlot, durationMs: t.durationMs };
  } catch (err) {
    log(`[rollback] FAILED: ${(err as Error).message}`);
    const t = await rec.finalise('failed', { notes: (err as Error).message });
    return { ok: false, durationMs: t.durationMs };
  }
}
