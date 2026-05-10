/**
 * Vitest-driven OpenAPI dumper for @vtorn/api.
 * Triggered by ../scripts/dump-openapi.ts via the package's `dump-openapi` script.
 * Do not run this file directly — it depends on vitest's import resolver.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from 'vitest';

import { buildServer } from '../src/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../../../docs/api/api.openapi.json');

test('dump-openapi: writes spec to docs/api/api.openapi.json', async () => {
  const app = await buildServer();
  await app.ready();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spec = (app as { swagger: () => unknown }).swagger();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n');
  await app.close();

  expect((spec as { openapi: string }).openapi).toBe('3.0.0');
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath}`);
});
