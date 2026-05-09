import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../src/server';

describe('GET /v1/affiliate/click', () => {
  let app: FastifyInstance;
  const FROZEN_TS = 1_715_000_000;

  beforeEach(async () => {
    const built = await buildServer({
      dbPath: ':memory:',
      now: () => FROZEN_TS,
      userHashSalt: 'test-salt-must-be-long-enough',
      disableRateLimit: true,
    });
    app = built.app;
  });

  afterEach(async () => {
    await app.close();
  });

  it('400 on missing partner', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?surface=bracket',
      headers: { 'cf-ipcountry': 'US' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_params');
  });

  it('400 on invalid surface', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=polymarket&surface=garbage',
      headers: { 'cf-ipcountry': 'US' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 on invalid partner format (uppercase)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=POLYMARKET&surface=bracket',
      headers: { 'cf-ipcountry': 'US' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 on invalid team_code (lowercase)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=polymarket&surface=bracket&team_code=arg',
      headers: { 'cf-ipcountry': 'US' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404 on unknown partner', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=mystery-book&surface=bracket',
      headers: { 'cf-ipcountry': 'US' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('partner_not_found');
  });

  it('422 when country cannot be resolved', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=polymarket&surface=bracket',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('country_unresolved');
  });

  it('422 when cf-ipcountry is XX (Tor / unknown)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=polymarket&surface=bracket',
      headers: { 'cf-ipcountry': 'XX' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('NZ user is blocked from Polymarket (geo_excluded)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=polymarket&surface=bracket',
      headers: { 'cf-ipcountry': 'NZ' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      reason: 'geo_excluded',
      country: 'NZ',
      partner: 'polymarket',
    });
  });

  it('NZ user is blocked from Polymarket even via ?country override', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=polymarket&surface=bracket&country=NZ',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().reason).toBe('geo_excluded');
  });

  it('US user is allowed Polymarket → 302 with affiliate ref', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=polymarket&surface=bracket',
      headers: { 'cf-ipcountry': 'US' },
    });
    expect(res.statusCode).toBe(302);
    const loc = res.headers['location'] as string;
    expect(loc).toBeTruthy();
    const u = new URL(loc);
    expect(u.hostname).toBe('polymarket.com');
    expect(u.searchParams.get('ref')).toBe('AFFCODE_PLACEHOLDER_polymarket');
    expect(u.searchParams.get('vt_surface')).toBe('bracket');
  });

  it('US user blocked from Sky NZ (geo_excluded)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=sky-nz&surface=match',
      headers: { 'cf-ipcountry': 'US' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().reason).toBe('geo_excluded');
  });

  it('NZ user is allowed Sky NZ → 302 with affiliate ref', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=sky-nz&surface=match&match_id=arg-fra-2026',
      headers: { 'cf-ipcountry': 'NZ' },
    });
    expect(res.statusCode).toBe(302);
    const u = new URL(res.headers['location'] as string);
    expect(u.hostname).toBe('www.skysport.co.nz');
    expect(u.searchParams.get('partner')).toBe('AFFCODE_PLACEHOLDER_sky_nz');
    expect(u.searchParams.get('vt_surface')).toBe('match');
    expect(u.searchParams.get('vt_match')).toBe('arg-fra-2026');
  });

  it('UK user allowed Bet365 → 302', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=bet365&surface=marketing',
      headers: { 'cf-ipcountry': 'GB' },
    });
    expect(res.statusCode).toBe(302);
    const u = new URL(res.headers['location'] as string);
    expect(u.hostname).toBe('www.bet365.com');
  });

  it('JP user allowed DAZN → 302', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=dazn&surface=match',
      headers: { 'cf-ipcountry': 'JP' },
    });
    expect(res.statusCode).toBe(302);
  });

  it('?country override works without cf-ipcountry header (dev path)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=espn-plus&surface=bracket&country=us',
    });
    expect(res.statusCode).toBe(302);
  });

  it('cf-ipcountry takes precedence over ?country', async () => {
    // CF says NZ, query says US; NZ wins → polymarket blocked.
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=polymarket&surface=bracket&country=US',
      headers: { 'cf-ipcountry': 'NZ' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().country).toBe('NZ');
  });

  it('logged click is recorded in the store with hashed user_id', async () => {
    const built = await buildServer({
      dbPath: ':memory:',
      now: () => FROZEN_TS,
      userHashSalt: 'test-salt-must-be-long-enough',
      disableRateLimit: true,
    });
    const res = await built.app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=polymarket&surface=bracket&user_id=user-abc&match_id=arg-fra&team_code=ARG&campaign_id=cmp-1',
      headers: { 'cf-ipcountry': 'US' },
    });
    expect(res.statusCode).toBe(302);
    const recent = built.ctx.store.recent(10);
    expect(recent.length).toBe(1);
    expect(recent[0]).toMatchObject({
      partner: 'polymarket',
      surface: 'bracket',
      country: 'US',
      match_id: 'arg-fra',
      team_code: 'ARG',
      campaign_id: 'cmp-1',
      ts: FROZEN_TS,
    });
    // user_id_hash must be SHA-256 hex (64 chars), never the raw id.
    expect(recent[0].user_id_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(recent[0].user_id_hash).not.toContain('user-abc');
    await built.app.close();
  });

  it('per-(user, partner) 24h cap kicks in on the 4th call', async () => {
    const built = await buildServer({
      dbPath: ':memory:',
      now: () => FROZEN_TS,
      userHashSalt: 'test-salt-must-be-long-enough',
      disableRateLimit: true,
    });
    const url =
      '/v1/affiliate/click?partner=polymarket&surface=bracket&user_id=u-1';
    const headers = { 'cf-ipcountry': 'US' };
    for (let i = 0; i < 3; i++) {
      const ok = await built.app.inject({ method: 'GET', url, headers });
      expect(ok.statusCode).toBe(302);
    }
    const blocked = await built.app.inject({ method: 'GET', url, headers });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({
      error: 'rate_limited',
      reason: 'per_user_partner_24h',
      limit: 3,
    });
    await built.app.close();
  });

  it('per-user cap is partner-scoped — same user can hit 3 polymarket + 3 espn', async () => {
    const built = await buildServer({
      dbPath: ':memory:',
      now: () => FROZEN_TS,
      userHashSalt: 'test-salt-must-be-long-enough',
      disableRateLimit: true,
    });
    const headers = { 'cf-ipcountry': 'US' };
    for (let i = 0; i < 3; i++) {
      const r = await built.app.inject({
        method: 'GET',
        url: '/v1/affiliate/click?partner=polymarket&surface=bracket&user_id=u-2',
        headers,
      });
      expect(r.statusCode).toBe(302);
    }
    const espn = await built.app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=espn-plus&surface=match&user_id=u-2',
      headers,
    });
    expect(espn.statusCode).toBe(302);
    await built.app.close();
  });

  it('per-user cap is per-user — user A cap does not affect user B', async () => {
    const built = await buildServer({
      dbPath: ':memory:',
      now: () => FROZEN_TS,
      userHashSalt: 'test-salt-must-be-long-enough',
      disableRateLimit: true,
    });
    const headers = { 'cf-ipcountry': 'US' };
    for (let i = 0; i < 3; i++) {
      await built.app.inject({
        method: 'GET',
        url: '/v1/affiliate/click?partner=polymarket&surface=bracket&user_id=u-A',
        headers,
      });
    }
    const otherUser = await built.app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=polymarket&surface=bracket&user_id=u-B',
      headers,
    });
    expect(otherUser.statusCode).toBe(302);
    await built.app.close();
  });

  it('cap window slides — clicks older than 24h do not count', async () => {
    let now = FROZEN_TS;
    const built = await buildServer({
      dbPath: ':memory:',
      now: () => now,
      userHashSalt: 'test-salt-must-be-long-enough',
      disableRateLimit: true,
    });
    const headers = { 'cf-ipcountry': 'US' };
    for (let i = 0; i < 3; i++) {
      await built.app.inject({
        method: 'GET',
        url: '/v1/affiliate/click?partner=polymarket&surface=bracket&user_id=u-3',
        headers,
      });
    }
    // jump 25h forward
    now += 25 * 3600;
    const ok = await built.app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=polymarket&surface=bracket&user_id=u-3',
      headers,
    });
    expect(ok.statusCode).toBe(302);
    await built.app.close();
  });

  it('anonymous (no user_id) clicks are not subject to the per-user cap', async () => {
    const built = await buildServer({
      dbPath: ':memory:',
      now: () => FROZEN_TS,
      userHashSalt: 'test-salt-must-be-long-enough',
      disableRateLimit: true,
    });
    const headers = { 'cf-ipcountry': 'US' };
    for (let i = 0; i < 5; i++) {
      const r = await built.app.inject({
        method: 'GET',
        url: '/v1/affiliate/click?partner=polymarket&surface=bracket',
        headers,
      });
      expect(r.statusCode).toBe(302);
    }
    await built.app.close();
  });

  it('redirect URL preserves partner-defined affiliate param key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=dazn&surface=marketing',
      headers: { 'cf-ipcountry': 'DE' },
    });
    expect(res.statusCode).toBe(302);
    const u = new URL(res.headers['location'] as string);
    // DAZN uses `promo` not `ref`.
    expect(u.searchParams.get('promo')).toBe('AFFCODE_PLACEHOLDER_dazn');
    expect(u.searchParams.get('ref')).toBeNull();
  });

  it('response is uncacheable (Cache-Control: no-store)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=polymarket&surface=bracket',
      headers: { 'cf-ipcountry': 'US' },
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('response includes X-VT-Click-Id correlation header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=polymarket&surface=bracket',
      headers: { 'cf-ipcountry': 'US' },
    });
    expect(res.headers['x-vt-click-id']).toBeTruthy();
    expect(res.headers['x-vt-click-id']).toMatch(/^c_[a-f0-9]+$/);
  });
});
