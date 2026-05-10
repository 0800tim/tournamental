/**
 * Dumps the @vtorn/api OpenAPI 3.0 spec to docs/api/api.openapi.json.
 *
 * Run: pnpm --filter @vtorn/api dump-openapi
 *
 * The dump is committed so consumers (the dashboard, internal tooling)
 * have a static copy without booting the service.
 *
 * We use the project's own vitest as the import resolver — vitest already
 * handles workspace `.ts`-main packages (e.g. `@vtorn/spec`) cleanly,
 * whereas Node's loader + `tsx` can't reconcile the `.ts` main with the
 * lack of `"type": "module"` on those packages.
 *
 * The shape: vitest runs `dump-openapi.run.ts` once as a regular test file,
 * which side-effects the spec to disk. Exit code follows vitest's.
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
  {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, VTORN_DUMP_OPENAPI: '1' },
  },
);

process.exit(result.status ?? 1);
