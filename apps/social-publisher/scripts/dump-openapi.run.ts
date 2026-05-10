/**
 * Vitest-driven OpenAPI dumper for @vtorn/social-publisher.
 *
 * social-publisher constructs its Fastify instance via `buildApp` (not
 * `buildServer`). The dumper imports `buildApp` directly and registers
 * swagger before extracting the spec.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from 'vitest';

import { buildApp } from '../src/server.js';
import { AuditLog } from '../src/lib/audit-log.js';
import { loadPolicy } from '../src/lib/policy.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../../../docs/api/social-publisher.openapi.json');

test('dump-openapi: writes social-publisher spec', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'social-dump-'));
  const policy = loadPolicy();
  const auditLog = new AuditLog(join(dataDir, 'posts.jsonl'));
  const app = await buildApp({ policy, auditLog, logger: false });

  await app.ready();
  const spec = (app as { swagger: () => unknown }).swagger();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n');
  await app.close();
  expect((spec as { openapi: string }).openapi).toBe('3.0.0');
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath}`);
});
