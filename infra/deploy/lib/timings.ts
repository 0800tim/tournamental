/**
 * timings.ts — append-only deploy-step timing recorder.
 *
 * Each call to `recordTimings()` appends a line to data/deploy-timings.jsonl
 * with one JSON object per deploy. Used by:
 *   - the deploy runbook ("what's normal" baseline)
 *   - the security/observability dashboards (read-only consumers)
 *   - post-mortem on slow deploys
 *
 * Best-effort — never throws on disk failure.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export interface DeployTimings {
  app: string;
  env: 'staging' | 'production';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: Array<{ name: string; durationMs: number; ok: boolean }>;
  outcome: 'success' | 'aborted-smoke' | 'rolled-back' | 'failed';
  buildId?: string;
  prevBuildId?: string;
  notes?: string;
}

export interface TimingsRecorderOptions {
  /** Where to append. Default: <repoRoot>/data/deploy-timings.jsonl */
  path?: string;
  /** repoRoot to compute the default path. */
  repoRoot?: string;
}

export class TimingsRecorder {
  private steps: Array<{ name: string; t0: number; durationMs?: number; ok?: boolean }> = [];
  private startedAt = new Date();
  private outPath: string;

  constructor(
    public readonly app: string,
    public readonly env: 'staging' | 'production',
    private readonly options: TimingsRecorderOptions = {},
  ) {
    const root = options.repoRoot ?? process.cwd();
    this.outPath = options.path ?? path.join(root, 'data', 'deploy-timings.jsonl');
  }

  /**
   * Run a step and record its timing. The callback's return value is passed
   * through. Throws are recorded as ok=false but rethrown.
   */
  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const entry = { name, t0: Date.now() };
    this.steps.push(entry);
    try {
      const r = await fn();
      Object.assign(entry, { durationMs: Date.now() - entry.t0, ok: true });
      return r;
    } catch (err) {
      Object.assign(entry, { durationMs: Date.now() - entry.t0, ok: false });
      throw err;
    }
  }

  /**
   * Append the timings line for this deploy. Best-effort — logs and swallows
   * disk errors so they never fail a deploy.
   */
  async finalise(
    outcome: DeployTimings['outcome'],
    extras: { buildId?: string; prevBuildId?: string; notes?: string } = {},
  ): Promise<DeployTimings> {
    const finishedAt = new Date();
    const out: DeployTimings = {
      app: this.app,
      env: this.env,
      startedAt: this.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - this.startedAt.getTime(),
      steps: this.steps.map(s => ({
        name: s.name,
        durationMs: s.durationMs ?? Date.now() - s.t0,
        ok: s.ok ?? false,
      })),
      outcome,
      ...extras,
    };

    try {
      await fsp.mkdir(path.dirname(this.outPath), { recursive: true });
      await fsp.appendFile(this.outPath, JSON.stringify(out) + '\n', 'utf8');
    } catch (err) {
      // best-effort — never fail a deploy because we can't write JSONL
      // eslint-disable-next-line no-console
      console.warn(`[timings] could not append to ${this.outPath}: ${(err as Error).message}`);
    }

    return out;
  }
}

/** Convenience for one-shot recording without the class. */
export async function appendTimings(
  out: DeployTimings,
  outPath: string,
): Promise<void> {
  if (!fs.existsSync(path.dirname(outPath))) {
    await fsp.mkdir(path.dirname(outPath), { recursive: true });
  }
  await fsp.appendFile(outPath, JSON.stringify(out) + '\n', 'utf8');
}
