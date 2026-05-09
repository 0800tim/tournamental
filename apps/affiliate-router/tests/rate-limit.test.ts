/**
 * @fastify/rate-limit per-IP throttle. We exercise the limiter directly with
 * RATE_LIMIT_MAX lowered to 5 via env so the test runs in milliseconds.
 *
 * NOTE: this test uses anonymous (no user_id) clicks so the per-(user, partner)
 * 24h cap is not on the path. Only the per-IP plugin counter matters.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

const SAVED_ENV = { ...process.env };

describe('per-IP rate limit (Fastify plugin)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.AFFILIATE_RATE_LIMIT_MAX = '5';
    // Re-import the server module after env mutation so the limiter picks up
    // the new max. Vitest re-evaluates on dynamic import.
    const mod = await import('../src/server');
    const built = await mod.buildServer({
      dbPath: ':memory:',
      userHashSalt: 'test-salt-must-be-long-enough',
    });
    app = built.app;
  });

  afterAll(async () => {
    await app.close();
    process.env = { ...SAVED_ENV };
  });

  it('blocks the 6th request from the same IP with 429', async () => {
    const headers = { 'cf-ipcountry': 'US', 'cf-connecting-ip': '203.0.113.7' };
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({
        method: 'GET',
        url: '/v1/affiliate/click?partner=polymarket&surface=bracket',
        headers,
      });
      expect(r.statusCode).toBe(302);
    }
    const sixth = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=polymarket&surface=bracket',
      headers,
    });
    expect(sixth.statusCode).toBe(429);
  });

  it('does not block a different IP', async () => {
    // The previous test exhausted IP 203.0.113.7. A fresh IP should pass.
    const r = await app.inject({
      method: 'GET',
      url: '/v1/affiliate/click?partner=polymarket&surface=bracket',
      headers: { 'cf-ipcountry': 'US', 'cf-connecting-ip': '198.51.100.42' },
    });
    expect(r.statusCode).toBe(302);
  });
});
