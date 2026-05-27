/**
 * publish.ts — the per-app deploy orchestrator.
 *
 * Generalises the prior project's publish.sh:
 *   1. acquire deploy lock for this app
 *   2. build to staging slot
 *   3. smoke-test staging on a private port
 *   4. atomic swap prod ← staging (prev ← old prod)
 *   5. PM2 reload (preferred) / restart (fallback)
 *   6. verify prod by hitting healthz; rollback if 5xx
 *   7. cache-warm the prod URLs
 *   8. release lock; record timings
 *
 * Returns a structured result regardless of outcome — never throws past
 * the boundary. Callers (publish-all.ts, GH workflow) inspect `outcome`.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { slotPaths, buildCommand, smokeStartCommand, type BuildKind, type SlotPaths } from './build-slots.js';
import { swap, rollbackSwap } from './swap.js';
import { smoke, type SmokeAssertion } from './smoke.js';
import { reloadOrRestart, pm2Save } from './pm2.js';
import { cacheWarm, type WarmTarget } from './cache-warm.js';
import { acquireLock } from './lock.js';
import { TimingsRecorder, type DeployTimings } from './timings.js';

export interface PublishConfig {
  /** App identifier, used in logs + PM2 name suffix. */
  app: string;
  /** Absolute path to the app directory. */
  appDir: string;
  /** Repo root (for env files, lock files, timings jsonl). */
  repoRoot: string;
  /** Build kind. */
  buildKind: BuildKind;
  /** Production HTTP port (for verify + warm). */
  port: number;
  /** Smoke port (private). Default 3099 + offset. Must not clash with prod. */
  smokePort?: number;
  /**
   * Extra env vars to inject into the smoke server alongside the
   * default { NODE_ENV, PORT, HOST }. Use for apps that read a custom
   * port/bind env name (e.g. odds-ingest reads ODDS_INGEST_PORT
   * instead of PORT). `${SMOKE_PORT}` is substituted with the chosen
   * smoke port at runtime; bare strings pass through verbatim.
   */
  smokeEnv?: Record<string, string>;
  /** PM2 process name for the prod slot. */
  pm2Name: string;
  /** Environment: staging or production. */
  env: 'staging' | 'production';
  /** PM2 ecosystem file used for first-time start. */
  ecosystemFile: string;
  /** Smoke assertions (paths only — base URL is the smoke server). */
  smoke: SmokeAssertion[];
  /** URL paths to warm post-deploy (will be hit at https://<host> in prod). */
  cacheWarm: string[];
  /** Hostname to use for cache-warm (e.g. https://tournamental.com). Defaults to localhost:port. */
  warmBase?: string;
  /** Healthz path. Default /healthz. */
  healthzPath?: string;
  /** Dry run — print what would happen, don't mutate. */
  dryRun?: boolean;
  /** Logger. */
  log?: (line: string) => void;
}

export interface PublishResult {
  app: string;
  env: 'staging' | 'production';
  outcome: DeployTimings['outcome'];
  durationMs: number;
  buildId?: string;
  prevBuildId?: string;
  steps: DeployTimings['steps'];
  notes?: string;
}

const DEFAULT_LOCK_DIR = '/tmp/vtorn-deploy-locks';

function defaultLog(line: string) {
  // eslint-disable-next-line no-console
  console.log(line);
}

async function execStreaming(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  log: (l: string) => void,
): Promise<{ code: number }> {
  return await new Promise((resolve) => {
    // shell:false so spawn forks `bash` directly with `-lc <script>` as
    // its argv, not via `/bin/sh -c "bash -lc <script>"` which would
    // collapse "<script>" into bash's $0/$1 and run the inner command
    // with no args (pnpm therefore printing help and exiting 0/1 with
    // no build output). The orchestrator only ever passes `bash -lc`
    // here so dropping shell:true loses no functionality.
    const c = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'pipe',
    });
    c.stdout?.on('data', (d) => log(`  ${d.toString().trimEnd()}`));
    c.stderr?.on('data', (d) => log(`  ${d.toString().trimEnd()}`));
    c.on('close', (code) => resolve({ code: code ?? 0 }));
    c.on('error', () => resolve({ code: 1 }));
  });
}

async function readBuildId(slot: string): Promise<string | undefined> {
  const p = path.join(slot, 'BUILD_ID');
  try {
    return (await fsp.readFile(p, 'utf8')).trim();
  } catch {
    return undefined;
  }
}

/** Run the orchestrator for a single app. Never throws past this boundary. */
export async function publish(config: PublishConfig): Promise<PublishResult> {
  const log = config.log ?? defaultLog;
  const dry = config.dryRun ?? false;
  const slots = slotPaths({ kind: config.buildKind, appDir: config.appDir });
  const smokePort = config.smokePort ?? 3099;
  const healthzPath = config.healthzPath ?? '/healthz';

  log(`\n=== publish ${config.app} (${config.env}) ===`);
  if (dry) log('[dry-run] no actual changes will be made');

  const rec = new TimingsRecorder(config.app, config.env, { repoRoot: config.repoRoot });
  const lockPath = path.join(DEFAULT_LOCK_DIR, `${config.app}.lock`);

  // ---- 1. lock ----
  let lock: Awaited<ReturnType<typeof acquireLock>> | undefined;
  try {
    if (!dry) {
      lock = await acquireLock({ path: lockPath, waitMs: 60_000 });
    }
    log(`[1/8] lock acquired (${lockPath})`);
  } catch (err) {
    log(`[FATAL] could not acquire deploy lock: ${(err as Error).message}`);
    const t = await rec.finalise('failed', { notes: 'lock-failure' });
    return {
      app: config.app,
      env: config.env,
      outcome: 'failed',
      durationMs: t.durationMs,
      steps: t.steps,
      notes: 'lock-failure',
    };
  }

  let outcome: DeployTimings['outcome'] = 'failed';
  let buildId: string | undefined;
  let prevBuildId: string | undefined;
  let notes: string | undefined;

  try {
    // ---- 2. build ----
    await rec.step('build', async () => {
      log(`[2/8] building → ${slots.staging}`);
      if (dry) {
        log('  [dry-run] skip build');
        return;
      }
      // wipe stale staging
      if (fs.existsSync(slots.staging)) {
        await fsp.rm(slots.staging, { recursive: true, force: true });
      }
      const bc = buildCommand({ kind: config.buildKind, appDir: config.appDir }, slots);
      const r = await execStreaming('bash', ['-lc', bc.cmd], config.appDir, bc.env, log);
      if (r.code !== 0) {
        throw new Error(`build failed (exit ${r.code})`);
      }
      // tools that don't honour custom build dirs (astro, tsc): mv after
      if (bc.postMove) {
        if (fs.existsSync(slots.staging)) {
          await fsp.rm(slots.staging, { recursive: true, force: true });
        }
        await fsp.rename(bc.postMove.from, bc.postMove.to);
      }
      buildId = await readBuildId(slots.staging);
      log(`  build OK${buildId ? ` (BUILD_ID=${buildId})` : ''}`);
    });

    // ---- 3. smoke ----
    let smokeResult: Awaited<ReturnType<typeof smoke>> | undefined;
    await rec.step('smoke', async () => {
      log(`[3/8] smoke testing on 127.0.0.1:${smokePort}`);
      if (dry) {
        log('  [dry-run] skip smoke');
        return;
      }
      const ssc = smokeStartCommand({ kind: config.buildKind, appDir: config.appDir }, slots, smokePort);
      // Merge the app's custom smokeEnv on top so apps that read a
      // bespoke port var (ODDS_INGEST_PORT, etc.) get the smoke port
      // wired. `${SMOKE_PORT}` template is the only placeholder we
      // expand; everything else passes through verbatim.
      const smokeEnv: Record<string, string> = { ...ssc.env };
      for (const [k, v] of Object.entries(config.smokeEnv ?? {})) {
        smokeEnv[k] = String(v).replace(/\$\{SMOKE_PORT\}/g, String(smokePort));
      }
      smokeResult = await smoke({
        startCmd: ssc.cmd,
        cwd: config.appDir,
        env: smokeEnv,
        port: smokePort,
        asserts: config.smoke,
        log,
        readyProbeUrl: healthzPath,
      });
      if (!smokeResult.passed) {
        throw new Error(
          `smoke failed: ${smokeResult.asserts.filter(a => !a.ok).map(a => a.label).join(', ')}`,
        );
      }
    });

    // ---- 4. swap ----
    await rec.step('swap', async () => {
      log(`[4/8] atomic swap prod ← staging`);
      if (dry) {
        log('  [dry-run] skip swap');
        return;
      }
      const r = await swap(slots, config.appDir);
      prevBuildId = r.prevBuildId;
      log(`  swapped in ${r.durationMs}ms (prev=${prevBuildId ?? 'none'})`);
    });

    // ---- 5. pm2 reload ----
    await rec.step('pm2', async () => {
      log(`[5/8] pm2 reload ${config.pm2Name}`);
      if (dry) {
        log('  [dry-run] skip pm2');
        return;
      }
      const r = await reloadOrRestart({
        name: config.pm2Name,
        ecosystemFile: config.ecosystemFile,
        env: config.env,
        log,
      });
      log(`  pm2 ${r.action} (${r.durationMs}ms)`);
      await pm2Save();
    });

    // ---- 6. verify prod ----
    let verifyOk = true;
    await rec.step('verify', async () => {
      log(`[6/8] verify prod localhost:${config.port}${healthzPath}`);
      if (dry) {
        log('  [dry-run] skip verify');
        return;
      }
      verifyOk = await waitForOk(`http://127.0.0.1:${config.port}${healthzPath}`, 30, log);
      if (!verifyOk) {
        throw new Error('prod verify failed');
      }
    });

    // ---- 7. cache warm ----
    await rec.step('warm', async () => {
      log(`[7/8] cache warm (${config.cacheWarm.length} URL(s))`);
      if (dry) {
        log('  [dry-run] skip warm');
        return;
      }
      const base = config.warmBase ?? `http://127.0.0.1:${config.port}`;
      const targets: WarmTarget[] = config.cacheWarm.map(url => ({
        url: `${base}${url}`,
        label: url,
      }));
      const results = await cacheWarm({ targets, log });
      const slow = results.filter(r => r.slow);
      if (slow.length > 0) {
        log(`  ${slow.length} URL(s) slower than budget (non-fatal)`);
      }
    });

    outcome = 'success';
    log(`[8/8] DONE ${config.app}`);
  } catch (err) {
    log(`[FAIL] ${(err as Error).message}`);
    notes = (err as Error).message;

    // Decide on outcome by where we failed:
    //   - smoke fail → 'aborted-smoke', no prod touched
    //   - verify fail → 'rolled-back', try to swap back
    //   - other → 'failed'
    if (notes.startsWith('smoke failed')) {
      outcome = 'aborted-smoke';
      // staging slot stays for inspection? we wipe per blue-green slot pattern.
      if (!dry) {
        try {
          await fsp.rm(slots.staging, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    } else if (notes === 'prod verify failed') {
      log('[recover] attempting rollback prev → prod');
      if (!dry) {
        try {
          await rollbackSwap(slots);
          await reloadOrRestart({
            name: config.pm2Name,
            ecosystemFile: config.ecosystemFile,
            env: config.env,
            log,
          });
          outcome = 'rolled-back';
        } catch (e) {
          log(`[recover] rollback failed too: ${(e as Error).message}`);
          outcome = 'failed';
        }
      } else {
        outcome = 'rolled-back';
      }
    } else {
      outcome = 'failed';
    }
  } finally {
    if (lock) {
      try {
        await lock.release();
      } catch {
        // ignore
      }
    }
  }

  const t = await rec.finalise(outcome, { buildId, prevBuildId, notes });
  return {
    app: config.app,
    env: config.env,
    outcome,
    durationMs: t.durationMs,
    buildId,
    prevBuildId,
    steps: t.steps,
    notes,
  };
}

async function waitForOk(url: string, timeoutSec: number, log: (l: string) => void): Promise<boolean> {
  for (let i = 0; i < timeoutSec; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (r.status >= 200 && r.status < 500) {
        log(`  prod ready after ${i + 1}s (HTTP ${r.status})`);
        return r.status < 400;
      }
    } catch {
      // not yet
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}
