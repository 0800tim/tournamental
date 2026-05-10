/**
 * Tests that GET /healthz reports per-adapter mode (real vs stub).
 *
 * In the test environment none of the real-adapter env vars are set, so
 * every adapter should report `stub`. This is a smoke test — the per-adapter
 * mode logic itself is exercised in the platform-specific tests.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuditLog } from '../src/lib/audit-log.js';
import type { SocialPolicy } from '../src/lib/policy.js';
import { buildApp } from '../src/server.js';

const policy: SocialPolicy = { default: { goal: ['discord'] } };

describe('GET /healthz', () => {
  let dir: string;
  let log: AuditLog;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sp-healthz-'));
    log = new AuditLog(join(dir, 'posts.jsonl'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports adapter_modes for every platform', async () => {
    const app = await buildApp({ policy, auditLog: log, logger: false });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      ok: boolean;
      adapters: string[];
      adapter_modes: Record<string, string>;
    };
    expect(body.ok).toBe(true);
    // Every registered adapter has a mode entry.
    for (const platform of body.adapters) {
      expect(body.adapter_modes[platform]).toMatch(/^(real|stub)$/);
    }
    // In the test env, with no real-adapter env vars, everything is stub.
    expect(body.adapter_modes.tiktok).toBe('stub');
    expect(body.adapter_modes['instagram-reels']).toBe('stub');
    expect(body.adapter_modes['youtube-shorts']).toBe('stub');
    expect(body.adapter_modes.x).toBe('stub');
    expect(body.adapter_modes.threads).toBe('stub');
    await app.close();
  });
});
