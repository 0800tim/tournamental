/**
 * Vitest-driven OpenAPI dumper for @vtorn/wc2026-data-scripts.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from 'vitest';

import { buildServer } from '../src/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../../../docs/api/wc2026-data.openapi.json');

test('dump-openapi: writes wc2026-data spec', async () => {
  const built = await buildServer({
    env: { ...process.env, WC2026_DATA_BACKEND: 'mock' },
    bridge: null,
  });
  const app = built.app;
  await app.ready();
  const spec = (app as { swagger: () => unknown }).swagger();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n');
  await app.close();
  expect((spec as { openapi: string }).openapi).toBe('3.0.0');
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath}`);
});
