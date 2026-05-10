#!/usr/bin/env tsx
/**
 * publish-all.ts — top-level orchestrator. Computes changed apps, runs each
 * app's publish() in parallel up to a concurrency cap.
 *
 * Usage:
 *   pnpm --filter @vtorn/cicd-tools run publish-all -- \
 *        --env=staging --concurrency=4 --dry-run
 *
 * Or all-apps mode (overrides change detection):
 *   pnpm ... publish-all -- --env=staging --apps=marketing,web,api
 */

import * as path from 'node:path';
import * as fs from 'node:fs';

import { detectChangedApps } from './lib/changed-apps.js';
import type { PublishConfig, PublishResult } from './lib/publish.js';

interface Args {
  env: 'staging' | 'production';
  concurrency: number;
  dryRun: boolean;
  apps?: string[];
  range?: string;
  /** If true, log only the JSON summary (good for CI consumers). */
  jsonOut: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    env: 'staging',
    concurrency: 4,
    dryRun: false,
    jsonOut: false,
  };
  for (const a of argv) {
    if (a.startsWith('--env=')) {
      const v = a.slice('--env='.length);
      if (v !== 'staging' && v !== 'production') throw new Error(`bad env: ${v}`);
      out.env = v;
    } else if (a.startsWith('--concurrency=')) {
      out.concurrency = Number(a.slice('--concurrency='.length));
    } else if (a === '--dry-run') {
      out.dryRun = true;
    } else if (a.startsWith('--apps=')) {
      out.apps = a.slice('--apps='.length).split(',').filter(Boolean);
    } else if (a.startsWith('--range=')) {
      out.range = a.slice('--range='.length);
    } else if (a === '--json') {
      out.jsonOut = true;
    }
  }
  return out;
}

function repoRoot(): string {
  // We sit at infra/deploy/. Go up two.
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
}

async function loadAppConfig(repo: string, app: string): Promise<PublishConfig | null> {
  const cfgPath = path.join(repo, 'apps', app, '.deploy', 'config.json');
  if (!fs.existsSync(cfgPath)) return null;
  const raw = await fs.promises.readFile(cfgPath, 'utf8');
  const cfg = JSON.parse(raw) as Partial<PublishConfig> & { pm2NameFromEnv?: { staging: string; production: string } };
  return cfg as PublishConfig;
}

async function runOne(
  repo: string,
  appSlug: string,
  args: Args,
): Promise<PublishResult> {
  const cfg = await loadAppConfig(repo, appSlug);
  if (!cfg) {
    return {
      app: appSlug,
      env: args.env,
      outcome: 'failed',
      durationMs: 0,
      steps: [],
      notes: `no config at apps/${appSlug}/.deploy/config.json`,
    };
  }
  const ecosystemFile = path.join(repo, 'infra', 'deploy', 'pm2', `${args.env}.config.cjs`);
  const pm2Suffix = args.env === 'production' ? 'prod' : 'staging';
  const pm2Name = (cfg as any).pm2NameFromEnv?.[args.env] ?? `vtorn-${appSlug}-${pm2Suffix}`;

  const fullCfg: PublishConfig = {
    ...(cfg as PublishConfig),
    app: appSlug,
    appDir: path.join(repo, 'apps', appSlug),
    repoRoot: repo,
    env: args.env,
    pm2Name,
    ecosystemFile,
    dryRun: args.dryRun,
  };

  // Lazy-import to keep the top of this file lightweight
  const { publish } = await import('./lib/publish.js');
  return publish(fullCfg);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const repo = repoRoot();

  let apps: string[];
  let rebuildAll = false;
  if (args.apps && args.apps.length > 0) {
    apps = args.apps;
  } else {
    const detect = detectChangedApps({ repoRoot: repo, range: args.range });
    rebuildAll = detect.rebuildAll;
    apps = detect.apps;
  }

  if (rebuildAll) {
    // discover all apps with .deploy/config.json
    const all = (await fs.promises.readdir(path.join(repo, 'apps'), { withFileTypes: true }))
      .filter(d => d.isDirectory())
      .map(d => d.name);
    apps = all.filter(a => fs.existsSync(path.join(repo, 'apps', a, '.deploy', 'config.json')));
  }

  if (apps.length === 0) {
    console.log('publish-all: no apps to deploy.');
    if (args.jsonOut) console.log(JSON.stringify({ apps: [], rebuildAll, results: [] }));
    return 0;
  }

  console.log(`publish-all: env=${args.env} apps=${apps.join(',')} rebuildAll=${rebuildAll} dryRun=${args.dryRun}`);

  // bounded-concurrency runner
  const queue = [...apps];
  const results: PublishResult[] = [];
  const conc = Math.max(1, args.concurrency);

  async function worker() {
    while (queue.length > 0) {
      const slug = queue.shift();
      if (!slug) return;
      const r = await runOne(repo, slug, args);
      results.push(r);
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, apps.length) }, () => worker()));

  // summary
  console.log('\n=== publish-all summary ===');
  let exit = 0;
  for (const r of results) {
    const tag = r.outcome === 'success' ? 'OK  ' : r.outcome === 'aborted-smoke' ? 'SMOKE' : r.outcome === 'rolled-back' ? 'BACK' : 'FAIL';
    console.log(`  [${tag}] ${r.app.padEnd(20)} ${r.durationMs}ms ${r.notes ?? ''}`);
    if (r.outcome === 'failed' || r.outcome === 'aborted-smoke') exit = 1;
  }
  if (args.jsonOut) console.log(JSON.stringify({ apps, rebuildAll, results }, null, 2));
  return exit;
}

const isDirect = (() => {
  try {
    const argv1 = process.argv[1] ? path.resolve(process.argv[1]) : '';
    const here = new URL(import.meta.url).pathname;
    return argv1 === here || argv1.endsWith('/publish-all.ts') || argv1.endsWith('/publish-all.js');
  } catch {
    return true;
  }
})();

if (isDirect) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { main };
