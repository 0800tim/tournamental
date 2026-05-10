/**
 * Vitest-driven OpenAPI dumper for @vtorn/vstamp.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from 'vitest';

import { buildServer } from '../src/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../../../docs/api/vstamp.openapi.json');

test('dump-openapi: writes vstamp spec', async () => {
  const app = await buildServer({
    dbPath: ':memory:',
    adminToken: 'dump-stub-admin-token',
    passphrase: 'dump-stub-passphrase-32-bytes-min--xxxxxxx',
  });
  await app.ready();
  const spec = (app as { swagger: () => unknown }).swagger();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n');
  await app.close();
  expect((spec as { openapi: string }).openapi).toBe('3.0.0');
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath}`);
});
