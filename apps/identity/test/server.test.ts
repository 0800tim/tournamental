import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../src/index.js';
import { Storage } from '../src/lib/storage.js';
import type { IdentityContext } from '../src/context.js';

let app: FastifyInstance;

const ADMIN_TOKEN = 'admin-test-token';

function buildCtx(): IdentityContext {
  const storage = new Storage({
    linksPath: '/tmp/__never__-links.jsonl',
    scoresPath: '/tmp/__never__-scores.jsonl',
    ephemeral: true,
  });
  return {
    storage,
    config: {
      publicBaseUrl: 'http://localhost:3392',
      adminToken: ADMIN_TOKEN,
    },
    now: () => 1_700_000_000_000,
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
}

beforeEach(async () => {
  app = await buildServer({ ctx: buildCtx() });
});

describe('identity server endpoints', () => {
  it('GET /healthz returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('GET /v1/version returns service + version', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/version' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: 'vtourn-identity', version: '0.1.0' });
  });

  it('POST /v1/links/start returns a mock URL with state', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/links/start',
      payload: { userId: 'u_alice', provider: 'google' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.provider).toBe('google');
    expect(body.authorizeUrl).toMatch(/^https:\/\//);
    expect(body.mock).toBe(true);
    expect(body.state).toMatch(/^st_/);
  });

  it('POST /v1/links/start rejects unknown provider', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/links/start',
      payload: { userId: 'u_alice', provider: 'myspace' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('callback persists a link and list returns it', async () => {
    const cbRes = await app.inject({
      method: 'POST',
      url: '/v1/links/callback',
      payload: {
        userId: 'u_alice',
        provider: 'google',
        externalId: 'g_1234',
        profile: { displayName: 'Alice' },
      },
    });
    expect(cbRes.statusCode).toBe(200);
    expect(cbRes.json().ok).toBe(true);

    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/users/u_alice/links',
    });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json();
    expect(list.count).toBe(1);
    expect(list.links[0].provider).toBe('google');
    expect(list.links[0].displayName).toBe('Alice');
  });

  it('GET humanness computes on-demand for an unknown user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/u_nobody/humanness',
    });
    expect(res.statusCode).toBe(200);
    const snap = res.json();
    expect(snap.userId).toBe('u_nobody');
    expect(snap.score).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(snap.factors)).toBe(true);
  });

  it('admin recompute requires bearer token', async () => {
    const noauth = await app.inject({
      method: 'POST',
      url: '/v1/users/u_alice/recompute',
      payload: {},
    });
    expect(noauth.statusCode).toBe(401);

    const ok = await app.inject({
      method: 'POST',
      url: '/v1/users/u_alice/recompute',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: {
        signals: { cadenceConsistency: 0.8, deviceStability: 0.8, captchaPassRate: 1 },
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().userId).toBe('u_alice');
  });
});
