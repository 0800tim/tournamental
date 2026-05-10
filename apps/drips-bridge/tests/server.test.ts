import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';

const ADMIN = 'test-admin-secret-32-characters!';
const A_ETH = '0x' + 'a'.repeat(40);
const B_ETH = '0x' + 'b'.repeat(40);

async function build(): Promise<{ app: FastifyInstance; ctx: Awaited<ReturnType<typeof buildServer>>['ctx'] }> {
  const { app, ctx } = await buildServer({
    dataDir: ':memory:',
    adminSecret: ADMIN,
    dripsBackend: 'mock',
    logger: false,
  });
  return { app, ctx };
}

describe('healthz + version', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    ({ app } = await build());
  });
  afterEach(async () => {
    await app.close();
  });

  it('GET /healthz is open and reports counts + backend', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe('@vtorn/drips-bridge');
    expect(body.contributors_loaded).toBe(0);
    expect(body.distributions_loaded).toBe(0);
    expect(body.drips_backend).toBe('mock');
  });

  it('GET /v1/version returns version + backend', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/version' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.service).toBe('@vtorn/drips-bridge');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.drips_backend).toBe('mock');
  });
});

describe('x-drips-admin enforcement', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    ({ app } = await build());
  });
  afterEach(async () => {
    await app.close();
  });

  it('blocks POST /v1/contributors without admin header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/contributors',
      payload: { githubLogin: 'alice' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('unauthorised');
  });

  it('blocks GET /v1/contributors without admin header', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/contributors' });
    expect(res.statusCode).toBe(401);
  });

  it('blocks POST /v1/distributions without admin header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/distributions',
      payload: { period: '2026-05', totalReceiptsUsd: 1000 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an incorrect admin secret', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/contributors',
      headers: { 'x-drips-admin': 'wrong' },
      payload: { githubLogin: 'alice' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts the correct admin secret', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/contributors',
      headers: { 'x-drips-admin': ADMIN },
      payload: { githubLogin: 'alice' },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('POST /v1/contributors', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    ({ app } = await build());
  });
  afterEach(async () => {
    await app.close();
  });

  it('creates a contributor (201)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/contributors',
      headers: { 'x-drips-admin': ADMIN },
      payload: { githubLogin: 'alice', activeShares: 100, role: 'core' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.created).toBe(true);
    expect(body.contributor.githubLogin).toBe('alice');
    expect(body.contributor.activeShares).toBe(100);
  });

  it('is idempotent on githubLogin (200, created=false)', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/contributors',
      headers: { 'x-drips-admin': ADMIN },
      payload: { githubLogin: 'alice', activeShares: 50 },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/contributors',
      headers: { 'x-drips-admin': ADMIN },
      payload: { githubLogin: 'alice', activeShares: 999 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toBe(false);
    expect(body.contributor.activeShares).toBe(50);
  });

  it('rejects an invalid body (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/contributors',
      headers: { 'x-drips-admin': ADMIN },
      payload: { githubLogin: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_body');
  });

  it('rejects malformed eth address', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/contributors',
      headers: { 'x-drips-admin': ADMIN },
      payload: { githubLogin: 'a', ethAddress: 'not-an-address' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /v1/contributors/:id', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    ({ app } = await build());
  });
  afterEach(async () => {
    await app.close();
  });

  it('updates ethAddress', async () => {
    const created = (
      await app.inject({
        method: 'POST',
        url: '/v1/contributors',
        headers: { 'x-drips-admin': ADMIN },
        payload: { githubLogin: 'alice' },
      })
    ).json().contributor;

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/contributors/${created.id}`,
      headers: { 'x-drips-admin': ADMIN },
      payload: { ethAddress: A_ETH, activeShares: 200 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.contributor.ethAddress).toBe(A_ETH);
    expect(body.contributor.activeShares).toBe(200);
  });

  it('returns 404 for missing contributor', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/contributors/c_does_not_exist',
      headers: { 'x-drips-admin': ADMIN },
      payload: { activeShares: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an empty patch body', async () => {
    const created = (
      await app.inject({
        method: 'POST',
        url: '/v1/contributors',
        headers: { 'x-drips-admin': ADMIN },
        payload: { githubLogin: 'alice' },
      })
    ).json().contributor;

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/contributors/${created.id}`,
      headers: { 'x-drips-admin': ADMIN },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/contributors', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    ({ app } = await build());
  });
  afterEach(async () => {
    await app.close();
  });

  it('lists contributors (admin-gated)', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/contributors',
      headers: { 'x-drips-admin': ADMIN },
      payload: { githubLogin: 'alice', activeShares: 10 },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/contributors',
      headers: { 'x-drips-admin': ADMIN },
      payload: { githubLogin: 'bob', activeShares: 20 },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/contributors',
      headers: { 'x-drips-admin': ADMIN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().contributors).toHaveLength(2);
  });
});

describe('Distributions lifecycle', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    ({ app } = await build());
  });
  afterEach(async () => {
    await app.close();
  });

  async function seedTwoContribsWithShares(): Promise<{ aId: string; bId: string }> {
    const a = (
      await app.inject({
        method: 'POST',
        url: '/v1/contributors',
        headers: { 'x-drips-admin': ADMIN },
        payload: {
          githubLogin: 'alice',
          activeShares: 30,
          ethAddress: A_ETH,
          role: 'core',
        },
      })
    ).json().contributor;
    const b = (
      await app.inject({
        method: 'POST',
        url: '/v1/contributors',
        headers: { 'x-drips-admin': ADMIN },
        payload: {
          githubLogin: 'bob',
          activeShares: 70,
          ethAddress: B_ETH,
          role: 'contributor',
        },
      })
    ).json().contributor;
    return { aId: a.id, bId: b.id };
  }

  it('creates a distribution with proportional splits', async () => {
    await seedTwoContribsWithShares();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/distributions',
      headers: { 'x-drips-admin': ADMIN },
      payload: { period: '2026-05', totalReceiptsUsd: 1000 },
    });
    expect(res.statusCode).toBe(201);
    const dist = res.json().distribution;
    expect(dist.status).toBe('pending');
    expect(dist.splits).toHaveLength(2);
    const total = dist.splits.reduce((acc: number, s: any) => acc + s.payoutUsd, 0);
    expect(total).toBe(1000);
  });

  it('refuses to create distribution if no eligible contributors', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/distributions',
      headers: { 'x-drips-admin': ADMIN },
      payload: { period: '2026-05', totalReceiptsUsd: 1000 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('no_eligible_contributors');
  });

  it('rejects invalid period', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/distributions',
      headers: { 'x-drips-admin': ADMIN },
      payload: { period: '2026/05', totalReceiptsUsd: 1000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('pushes a distribution and stamps txHash', async () => {
    await seedTwoContribsWithShares();
    const created = (
      await app.inject({
        method: 'POST',
        url: '/v1/distributions',
        headers: { 'x-drips-admin': ADMIN },
        payload: { period: '2026-05', totalReceiptsUsd: 500 },
      })
    ).json().distribution;
    const pushed = (
      await app.inject({
        method: 'POST',
        url: `/v1/distributions/${created.id}/push`,
        headers: { 'x-drips-admin': ADMIN },
      })
    ).json().distribution;
    expect(pushed.status).toBe('pushed');
    expect(pushed.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    for (const s of pushed.splits) {
      expect(s.txHash).toBe(pushed.txHash);
    }
  });

  it('refuses to push twice', async () => {
    await seedTwoContribsWithShares();
    const created = (
      await app.inject({
        method: 'POST',
        url: '/v1/distributions',
        headers: { 'x-drips-admin': ADMIN },
        payload: { period: '2026-05', totalReceiptsUsd: 500 },
      })
    ).json().distribution;
    await app.inject({
      method: 'POST',
      url: `/v1/distributions/${created.id}/push`,
      headers: { 'x-drips-admin': ADMIN },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/distributions/${created.id}/push`,
      headers: { 'x-drips-admin': ADMIN },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('already_pushed');
  });

  it('refuses to push when a contributor lacks ethAddress', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/contributors',
      headers: { 'x-drips-admin': ADMIN },
      payload: { githubLogin: 'no-wallet', activeShares: 100 },
    });
    const created = (
      await app.inject({
        method: 'POST',
        url: '/v1/distributions',
        headers: { 'x-drips-admin': ADMIN },
        payload: { period: '2026-05', totalReceiptsUsd: 100 },
      })
    ).json().distribution;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/distributions/${created.id}/push`,
      headers: { 'x-drips-admin': ADMIN },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('eth_address_missing');
  });

  it('returns 404 for unknown distribution on push', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/distributions/d_nope/push',
      headers: { 'x-drips-admin': ADMIN },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /v1/distributions/:id returns the distribution', async () => {
    await seedTwoContribsWithShares();
    const created = (
      await app.inject({
        method: 'POST',
        url: '/v1/distributions',
        headers: { 'x-drips-admin': ADMIN },
        payload: { period: '2026-05', totalReceiptsUsd: 100 },
      })
    ).json().distribution;
    const res = await app.inject({
      method: 'GET',
      url: `/v1/distributions/${created.id}`,
      headers: { 'x-drips-admin': ADMIN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().distribution.id).toBe(created.id);
  });

  it('GET /v1/distributions/:id returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/distributions/d_nope',
      headers: { 'x-drips-admin': ADMIN },
    });
    expect(res.statusCode).toBe(404);
  });
});
