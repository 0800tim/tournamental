import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../src/server';

describe('GET /v1/affiliate/partners', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const built = await buildServer({
      dbPath: ':memory:',
      userHashSalt: 'test-salt-must-be-long-enough',
      disableRateLimit: true,
    });
    app = built.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('NZ user does NOT see Polymarket', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/partners',
      headers: { 'cf-ipcountry': 'NZ' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.country).toBe('NZ');
    const ids = body.partners.map((p: { id: string }) => p.id);
    expect(ids).not.toContain('polymarket');
    // NZ should see Sky NZ.
    expect(ids).toContain('sky-nz');
  });

  it('US user sees Polymarket and ESPN+, not Sky NZ', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/partners',
      headers: { 'cf-ipcountry': 'US' },
    });
    const ids = res.json().partners.map((p: { id: string }) => p.id);
    expect(ids).toContain('polymarket');
    expect(ids).toContain('espn-plus');
    expect(ids).not.toContain('sky-nz');
    expect(ids).not.toContain('dazn');
  });

  it('DE user sees DAZN and Bet365', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/partners',
      headers: { 'cf-ipcountry': 'DE' },
    });
    const ids = res.json().partners.map((p: { id: string }) => p.id);
    expect(ids).toContain('dazn');
    expect(ids).toContain('bet365');
    expect(ids).not.toContain('polymarket');
    expect(ids).not.toContain('sky-nz');
  });

  it('AU user sees Bet365 only', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/partners',
      headers: { 'cf-ipcountry': 'AU' },
    });
    const ids = res.json().partners.map((p: { id: string }) => p.id);
    expect(ids).toContain('bet365');
    expect(ids).not.toContain('polymarket');
  });

  it('an unmapped country (ZW) returns an empty list, not an error', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/partners',
      headers: { 'cf-ipcountry': 'ZW' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().partners).toEqual([]);
  });

  it('422 when country cannot be resolved', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/partners',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('country_unresolved');
  });

  it('?country query works as a fallback', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/partners?country=NZ',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().country).toBe('NZ');
  });

  it('partner objects expose only public fields (no affiliate code)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/partners?country=US',
    });
    const p = res.json().partners[0];
    expect(p).toHaveProperty('id');
    expect(p).toHaveProperty('name');
    expect(p).toHaveProperty('kind');
    expect(p).toHaveProperty('offer_text');
    expect(p).toHaveProperty('logo_url');
    expect(p).not.toHaveProperty('affiliate_param_value');
    expect(p).not.toHaveProperty('affiliate_param_name');
    expect(p).not.toHaveProperty('base_url');
    expect(p).not.toHaveProperty('allowed_countries');
  });

  it('list response is edge-cacheable (public, max-age, SWR)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/partners?country=US',
    });
    const cc = res.headers['cache-control'] as string;
    expect(cc).toMatch(/public/);
    expect(cc).toMatch(/max-age=/);
    expect(cc).toMatch(/stale-while-revalidate/);
  });

  it('country code is normalised (lowercase query → uppercase response)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/partners?country=de',
    });
    expect(res.json().country).toBe('DE');
  });
});

describe('GET /healthz', () => {
  it('reports partners_loaded count', async () => {
    const built = await buildServer({
      dbPath: ':memory:',
      userHashSalt: 'test-salt-must-be-long-enough',
      disableRateLimit: true,
    });
    const res = await built.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe('@vtorn/affiliate-router');
    expect(body.partners_loaded).toBeGreaterThanOrEqual(5);
    expect(body.ts).toBeTypeOf('string');
    await built.app.close();
  });

  it('healthz is uncacheable', async () => {
    const built = await buildServer({
      dbPath: ':memory:',
      userHashSalt: 'test-salt-must-be-long-enough',
      disableRateLimit: true,
    });
    const res = await built.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.headers['cache-control']).toBe('no-store');
    await built.app.close();
  });
});
