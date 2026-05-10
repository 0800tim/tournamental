/**
 * Vitest-driven OpenAPI dumper for @vtorn/clip-pipeline.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from 'vitest';

import { buildApp } from '../src/api.js';
import { ClipQueue } from '../src/queue.js';
import type { FfmpegRunner } from '../src/ffmpeg.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../../../docs/api/clip-pipeline.openapi.json');

const stubFfmpeg: FfmpegRunner = {
  async available() {
    return false;
  },
  async run() {
    return { ok: false as const, error: 'dump-openapi: ffmpeg disabled' };
  },
};

test('dump-openapi: writes clip-pipeline spec', async () => {
  const storage = mkdtempSync(join(tmpdir(), 'clip-dump-'));
  const queue = new ClipQueue({
    ffmpeg: stubFfmpeg,
    storagePath: storage,
    storageUrl: null,
  });

  const app = await buildApp({
    queue,
    ffmpeg: stubFfmpeg,
    fetchEvents: async () => [],
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
