/**
 * Vitest-driven OpenAPI dumper for @vtourn/odds-ingest.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from 'vitest';

import { buildApp } from '../src/api.js';
import { loadDataPack } from '../src/data.js';
import { OddsStore } from '../src/store/sqlite.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../../../docs/api/odds-ingest.openapi.json');

test('dump-openapi: writes odds-ingest spec', async () => {
  const store = new OddsStore({ dbPath: ':memory:' });
  const data = loadDataPack();
  const app = await buildApp({ store, data, poller: null });

  await app.ready();
  const spec = (app as { swagger: () => unknown }).swagger();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n');
  await app.close();
  expect((spec as { openapi: string }).openapi).toBe('3.0.0');
  store.close();
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath}`);
});
