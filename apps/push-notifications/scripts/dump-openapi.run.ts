/**
 * Vitest-driven OpenAPI dumper for @vtorn/push-notifications.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from 'vitest';

import { buildServer } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../../../docs/api/push-notifications.openapi.json');

test('dump-openapi: writes push-notifications spec', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'push-dump-'));
  const built = await buildServer({
    subscriptionsPath: join(dataDir, 'subs.jsonl'),
    auditPath: join(dataDir, 'audit.jsonl'),
    whatsappAuditPath: join(dataDir, 'wa-audit.jsonl'),
    smsAuditPath: join(dataDir, 'sms-audit.jsonl'),
    schedulerStatePath: join(dataDir, 'sched.json'),
    bootScheduler: false,
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
