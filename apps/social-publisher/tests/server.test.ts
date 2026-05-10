import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuditLog } from '../src/lib/audit-log.js';
import type { SocialPolicy } from '../src/lib/policy.js';
import { buildApp, SERVICE_VERSION } from '../src/server.js';
import { makeClip } from './fixtures.js';

const policy: SocialPolicy = {
  default: {
    goal: ['x', 'tiktok', 'discord'],
  },
};

describe('Fastify server', () => {
  let dir: string;
  let log: AuditLog;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'social-publisher-server-'));
    log = new AuditLog(join(dir, 'posts.jsonl'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('GET /healthz returns 200 with adapter list', async () => {
    const app = buildApp({ policy, auditLog: log, logger: false });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; adapters: string[] };
    expect(body.ok).toBe(true);
    expect(body.adapters).toContain('tiktok');
    expect(body.adapters.length).toBe(9);
    await app.close();
  });

  it('GET /v1/version returns the service version', async () => {
    const app = buildApp({ policy, auditLog: log, logger: false });
    const res = await app.inject({ method: 'GET', url: '/v1/version' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { service: string; version: string; adapter_count: number };
    expect(body.service).toBe('social-publisher');
    expect(body.version).toBe(SERVICE_VERSION);
    expect(body.adapter_count).toBe(9);
    await app.close();
  });

  it('POST /v1/publish fans out to the policy-selected platforms', async () => {
    const app = buildApp({ policy, auditLog: log, logger: false });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/publish',
      payload: makeClip(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      clipId: string;
      results: Array<{ platform: string; status: string; externalId?: string }>;
    };
    expect(body.clipId).toBe('clip_test_001');
    expect(body.results).toHaveLength(3);
    const platforms = body.results.map((r) => r.platform).sort();
    expect(platforms).toEqual(['discord', 'tiktok', 'x']);
    expect(body.results.every((r) => r.status === 'published')).toBe(true);
    expect(body.results.every((r) => r.externalId && r.externalId.length > 0)).toBe(true);

    // Audit log should have one row per published platform.
    const rows = await log.readAll();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'published')).toBe(true);
    expect(rows.every((r) => r.clipId === 'clip_test_001')).toBe(true);

    await app.close();
  });

  it('POST /v1/publish 400s on a malformed body', async () => {
    const app = buildApp({ policy, auditLog: log, logger: false });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/publish',
      payload: { clipId: 'x' /* missing required fields */ },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; issues: unknown[] };
    expect(body.error).toBe('invalid_clip_ready');
    expect(Array.isArray(body.issues)).toBe(true);
    await app.close();
  });

  it('POST /v1/publish with whatsapp in policy fans out via the registered adapter', async () => {
    const waPolicy: SocialPolicy = { default: { goal: ['whatsapp'] } };
    const app = buildApp({ policy: waPolicy, auditLog: log, logger: false });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/publish',
      payload: makeClip(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: Array<{ platform: string; status: string; url?: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]?.platform).toBe('whatsapp');
    expect(body.results[0]?.status).toBe('published');
    await app.close();
  });

  it('POST /v1/publish with no matching policy returns empty results', async () => {
    const app = buildApp({ policy, auditLog: log, logger: false });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/publish',
      payload: makeClip({ eventType: 'tournament-recap' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: unknown[] };
    expect(body.results).toEqual([]);
    expect(await log.readAll()).toEqual([]);
    await app.close();
  });
});
