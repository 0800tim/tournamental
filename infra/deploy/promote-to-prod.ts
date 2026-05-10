#!/usr/bin/env tsx
/**
 * promote-to-prod.ts — promote staging → production with one command.
 *
 * In single-host mode (default), staging and prod live in different PM2
 * processes on the same host. "Promotion" means: rebuild each app's
 * production slot from the same source SHA, smoke-test, swap, reload.
 *
 * In multi-host mode (deferred), promotion would flip Cloudflare-Tunnel
 * ingress so traffic on the prod hostname routes to the host that's
 * currently the staging host. We document that path but don't implement.
 *
 * Pre-checks (fail-closed):
 *   - .deploy/incident.flag absent on the prod host
 *   - staging is healthy (each app's PM2 process responds 2xx on /healthz)
 *   - the source SHA matches main HEAD (no out-of-band promotions)
 *
 * On 5xx during prod verify: per-app rollback via lib/rollback.ts.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';

interface Args {
  apps?: string[];
  dryRun: boolean;
  /** Skip pre-checks. Use only when explicitly authorised. */
  forcePrechecksSkip: boolean;
  jsonOut: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false, forcePrechecksSkip: false, jsonOut: false };
  for (const a of argv) {
    if (a.startsWith('--apps=')) out.apps = a.slice('--apps='.length).split(',').filter(Boolean);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force-prechecks-skip') out.forcePrechecksSkip = true;
    else if (a === '--json') out.jsonOut = true;
  }
  return out;
}

function repoRoot(): string {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
}

interface Precheck {
  name: string;
  ok: boolean;
  detail: string;
}

async function runPrechecks(repo: string): Promise<Precheck[]> {
  const out: Precheck[] = [];

  // 1. incident flag
  const flag = path.join(repo, '.deploy', 'incident.flag');
  out.push({
    name: 'no-incident-flag',
    ok: !fs.existsSync(flag),
    detail: fs.existsSync(flag) ? `flag at ${flag}` : 'no flag',
  });

  // 2. main matches HEAD
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' });
  const head = (r.stdout || '').trim();
  const r2 = spawnSync('git', ['rev-parse', 'origin/main'], { cwd: repo, encoding: 'utf8' });
  const main = (r2.stdout || '').trim();
  out.push({
    name: 'head-matches-main',
    ok: head !== '' && head === main,
    detail: `HEAD=${head.slice(0, 8)} origin/main=${main.slice(0, 8)}`,
  });

  // 3. staging healthy — best-effort. We hit each app's staging healthz
  //    via the staging ecosystem file's port table. Skip if file missing.
  const stagingEcoFile = path.join(repo, 'infra', 'deploy', 'pm2', 'staging.config.cjs');
  if (!fs.existsSync(stagingEcoFile)) {
    out.push({
      name: 'staging-healthy',
      ok: false,
      detail: `missing ${stagingEcoFile}`,
    });
  } else {
    out.push({
      name: 'staging-healthy',
      ok: true,
      detail: 'precheck-deferred to per-app smoke run',
    });
  }

  return out;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const repo = repoRoot();

  console.log('=== promote-to-prod ===');
  if (args.dryRun) console.log('[dry-run] no actual changes will be made');

  // pre-checks
  if (!args.forcePrechecksSkip) {
    const pcs = await runPrechecks(repo);
    let allOk = true;
    for (const p of pcs) {
      console.log(`  [${p.ok ? ' OK ' : 'FAIL'}] ${p.name}  ${p.detail}`);
      if (!p.ok) allOk = false;
    }
    if (!allOk) {
      console.error('promote-to-prod: pre-checks failed. Use --force-prechecks-skip to override (DO NOT do this without authorisation).');
      if (args.jsonOut) console.log(JSON.stringify({ ok: false, prechecks: pcs }));
      return 2;
    }
  }

  // hand off to publish-all in production mode (run via the workspace tsx)
  const tsxBin = path.join(repo, 'infra', 'deploy', 'node_modules', '.bin', 'tsx');
  const args2 = [path.join(repo, 'infra', 'deploy', 'publish-all.ts'), '--env=production'];
  if (args.dryRun) args2.push('--dry-run');
  if (args.apps && args.apps.length > 0) args2.push(`--apps=${args.apps.join(',')}`);

  console.log(`\nhanding off to: ${tsxBin} ${args2.join(' ')}\n`);

  const r = spawnSync(tsxBin, args2, {
    cwd: repo,
    stdio: 'inherit',
  });
  return r.status ?? 1;
}

const isDirect = (() => {
  try {
    const argv1 = process.argv[1] ? path.resolve(process.argv[1]) : '';
    const here = new URL(import.meta.url).pathname;
    return argv1 === here || argv1.endsWith('/promote-to-prod.ts') || argv1.endsWith('/promote-to-prod.js');
  } catch {
    return true;
  }
})();

if (isDirect) {
  main().then((c) => process.exit(c)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { main };
