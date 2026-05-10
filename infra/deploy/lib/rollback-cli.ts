#!/usr/bin/env tsx
/**
 * Tiny CLI wrapper around rollback() for the operator runbook.
 *
 * Usage:
 *   pnpm --filter @vtorn/cicd-tools exec tsx infra/deploy/lib/rollback-cli.ts \
 *     --app=marketing --buildKind=astro
 */

import * as path from 'node:path';
import { rollback } from './rollback.js';
import type { BuildKind } from './build-slots.js';

interface Args {
  app: string;
  buildKind: BuildKind;
  pm2Name?: string;
  env: 'staging' | 'production';
}

function parseArgs(argv: string[]): Args {
  let app = '';
  let buildKind: BuildKind = 'next';
  let pm2Name: string | undefined;
  let env: 'staging' | 'production' = 'production';
  for (const a of argv) {
    if (a.startsWith('--app=')) app = a.slice('--app='.length);
    else if (a.startsWith('--buildKind=')) buildKind = a.slice('--buildKind='.length) as BuildKind;
    else if (a.startsWith('--pm2-name=')) pm2Name = a.slice('--pm2-name='.length);
    else if (a.startsWith('--env=')) env = a.slice('--env='.length) as 'staging' | 'production';
  }
  if (!app) throw new Error('--app required');
  return { app, buildKind, pm2Name, env };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
  const r = await rollback({
    app: args.app,
    appDir: path.join(repo, 'apps', args.app),
    buildKind: args.buildKind,
    pm2Name: args.pm2Name ?? `vtorn-${args.app}-${args.env === 'production' ? 'prod' : 'staging'}`,
    ecosystemFile: path.join(repo, 'infra', 'deploy', 'pm2', `${args.env}.config.cjs`),
    repoRoot: repo,
  });
  if (r.ok) {
    console.log(`rollback OK; failed slot at ${r.failedSlot} (${r.durationMs}ms)`);
    return 0;
  }
  console.error('rollback FAILED');
  return 1;
}

const argv1 = process.argv[1] ? path.resolve(process.argv[1]) : '';
const here = new URL(import.meta.url).pathname;
if (argv1 === here || argv1.endsWith('/rollback-cli.ts') || argv1.endsWith('/rollback-cli.js')) {
  main().then(c => process.exit(c)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

export { main };
