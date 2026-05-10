/**
 * Backend-selection + admin-replay tests. Validate that:
 *   - `CRM_BACKEND=mock` (default) keeps the JSONL-mock behaviour.
 *   - `CRM_BACKEND=real` requires GHL_API_KEY + GHL_LOCATION_ID and throws
 *     a clear error when either is missing.
 *   - `/v1/admin/replay-failed` is auth-gated and walks the failed-log.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../src/server.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
  delete process.env.CRM_BACKEND;
  delete process.env.GHL_API_KEY;
  delete process.env.GHL_LOCATION_ID;
  delete process.env.GHL_API_BASE_URL;
  delete process.env.CRM_GHL_FAILED_LOG_PATH;
  delete process.env.CRM_ADMIN_TOKEN;
});

describe('buildServer backend selection', () => {
  it('defaults to mock backend when CRM_BACKEND is unset', async () => {
    const built = await buildServer({
      ghlLogPath: null,
      logger: false,
    });
    app = built.app;
    expect(built.backend).toBe('mock');
  });

  it('throws when CRM_BACKEND=real but credentials are missing', async () => {
    process.env.CRM_BACKEND = 'real';
    await expect(
      buildServer({ logger: false }),
    ).rejects.toThrow(/GHL_API_KEY and GHL_LOCATION_ID/);
  });

  it('throws when GHL_API_KEY missing', async () => {
    process.env.CRM_BACKEND = 'real';
    process.env.GHL_LOCATION_ID = 'loc';
    await expect(
      buildServer({ logger: false }),
    ).rejects.toThrow(/GHL_API_KEY/);
  });

  it('builds a real backend when both env vars are set', async () => {
    process.env.CRM_BACKEND = 'real';
    process.env.GHL_API_KEY = 'sk_test';
    process.env.GHL_LOCATION_ID = 'loc_1';
    const built = await buildServer({
      logger: false,
      ghlFailedLogPath: null,
    });
    app = built.app;
    expect(built.backend).toBe('real');
  });
});

describe('POST /v1/admin/replay-failed', () => {
  let tmpDir: string;
  let failedPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'crm-admin-'));
    failedPath = join(tmpDir, 'ghl-failed.jsonl');
  });

  it('returns 401 without a valid bearer token', async () => {
    process.env.CRM_BACKEND = 'real';
    process.env.GHL_API_KEY = 'sk';
    process.env.GHL_LOCATION_ID = 'loc';
    const built = await buildServer({
      logger: false,
      ghlFailedLogPath: failedPath,
      adminToken: 'topsecret',
    });
    app = built.app;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/replay-failed',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 503 when no admin token is configured', async () => {
    process.env.CRM_BACKEND = 'real';
    process.env.GHL_API_KEY = 'sk';
    process.env.GHL_LOCATION_ID = 'loc';
    const built = await buildServer({
      logger: false,
      ghlFailedLogPath: failedPath,
      adminToken: null,
    });
    app = built.app;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/replay-failed',
      headers: { authorization: 'Bearer anything' },
    });
    expect(res.statusCode).toBe(503);
  });

  it('returns 501 on the mock backend', async () => {
    const built = await buildServer({
      logger: false,
      ghlLogPath: null,
      adminToken: 'topsecret',
    });
    app = built.app;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/replay-failed',
      headers: { authorization: 'Bearer topsecret' },
    });
    expect(res.statusCode).toBe(501);
  });

  it('returns zeros when the failed-log does not exist yet', async () => {
    process.env.CRM_BACKEND = 'real';
    process.env.GHL_API_KEY = 'sk';
    process.env.GHL_LOCATION_ID = 'loc';
    const built = await buildServer({
      logger: false,
      ghlFailedLogPath: failedPath,
      adminToken: 'topsecret',
    });
    app = built.app;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/replay-failed',
      headers: { authorization: 'Bearer topsecret' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      attempted: 0,
      succeeded: 0,
      failed: 0,
      residual: 0,
    });
  });

  it('walks the failed-log, replays each entry, and rewrites residuals', async () => {
    // Stage a failed-log with two entries; one will succeed, one will
    // fail again. We point the RealGhlClient at a fake fetch via the
    // GHL_API_BASE_URL env var indirection — but since the client is
    // built inside buildServer, easier route is to inject a custom
    // RealGhlClient directly.
    writeFileSync(
      failedPath,
      [
        JSON.stringify({
          ts: 1,
          op: 'add_tags',
          contactId: 'gh_a',
          payload: {
            method: 'POST',
            path: '/contacts/gh_a/tags',
            body: { tags: ['t1'] },
          },
          error: { message: 'http_500' },
        }),
        JSON.stringify({
          ts: 2,
          op: 'add_tags',
          contactId: 'gh_b',
          payload: {
            method: 'POST',
            path: '/contacts/gh_b/tags',
            body: { tags: ['t2'] },
          },
          error: { message: 'http_500' },
        }),
      ].join('\n') + '\n',
      'utf8',
    );

    // Inject a RealGhlClient with a queued fetch.
    const { RealGhlClient } = await import('../src/lib/ghl-client.js');
    const responses: Response[] = [
      new Response('{"ok":true}', { status: 200 }),
      new Response('{"error":"still_broken"}', { status: 500 }),
      new Response('{"error":"still_broken"}', { status: 500 }),
      new Response('{"error":"still_broken"}', { status: 500 }),
      new Response('{"error":"still_broken"}', { status: 500 }),
    ];
    let i = 0;
    const fakeFetch: typeof fetch = async () => {
      const r = responses[i++];
      if (!r) throw new Error('out of responses');
      return r;
    };
    const realClient = new RealGhlClient({
      apiKey: 'sk',
      locationId: 'loc',
      failedLogPath: failedPath,
      fetchImpl: fakeFetch,
      sleep: async () => {},
    });

    const built = await buildServer({
      logger: false,
      ghlClient: realClient,
      ghlFailedLogPath: failedPath,
      adminToken: 'topsecret',
    });
    app = built.app;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/replay-failed',
      headers: { authorization: 'Bearer topsecret' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      attempted: 2,
      succeeded: 1,
      failed: 1,
      residual: 1,
    });

    // The residual entry was rewritten; the success is gone. The
    // failed-log will *also* now contain a fresh failure record from
    // the second replay's exhausted retries (RealGhlClient appends on
    // any final-failure write). That's acceptable — the next replay
    // pass picks up both lines.
    expect(existsSync(failedPath)).toBe(true);
    const remaining = readFileSync(failedPath, 'utf8');
    expect(remaining).toContain('"contactId":"gh_b"');
    expect(remaining).not.toContain('"contactId":"gh_a"');
  });
});
