/**
 * Vitest-driven OpenAPI dumper for @vtorn/dm-poll-forwarder.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from 'vitest';

import { buildServer } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../../../docs/api/dm-poll-forwarder.openapi.json');

test('dump-openapi: writes dm-poll-forwarder spec', async () => {
  const built = await buildServer();
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
