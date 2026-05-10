/**
 * Dumps this service's OpenAPI 3.0 spec to docs/api/<service>.openapi.json.
 * Runs via vitest because workspace packages with `.ts` mains (e.g.
 * `@vtorn/spec`) don't resolve cleanly under tsx + Node's ESM loader.
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cliBin = resolve(here, '../node_modules/.bin/vitest');
const runFile = resolve(here, 'dump-openapi.run.ts');
const cwd = resolve(here, '..');

const result = spawnSync(
  cliBin,
  [
    'run',
    '--no-coverage',
    '--reporter=basic',
    '--config',
    resolve(here, 'dump-openapi.vitest.config.ts'),
    runFile,
  ],
  { cwd, stdio: 'inherit', env: { ...process.env, VTORN_DUMP_OPENAPI: '1' } },
);

process.exit(result.status ?? 1);
