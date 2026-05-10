/**
 * Vitest-driven OpenAPI dumper for @vtorn/auth-sms.
 * Triggered by ../scripts/dump-openapi.ts via `pnpm dump-openapi`.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from 'vitest';

import { buildServer } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../../../docs/api/auth-sms.openapi.json');

test('dump-openapi: writes auth-sms spec', async () => {
  // Use stub clients so we don't need real Aiva creds at dump time.
  const app = await buildServer();
  await app.ready();
  const spec = (app as { swagger: () => unknown }).swagger();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n');
  await app.close();
  expect((spec as { openapi: string }).openapi).toBe('3.0.0');
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath}`);
});
