import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHarness, type Harness } from './helpers.js';

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(async () => {
  await h.app.close();
});

describe('GET /v1/auth/dm-otp/start-info', () => {
  it('400 on bad channel', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/v1/auth/dm-otp/start-info?channel=pigeon',
    });
    expect(res.statusCode).toBe(400);
  });

  it('telegram — returns tg:// + t.me URLs', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/v1/auth/dm-otp/start-info?channel=telegram',
    });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.appUrl).toBe('tg://resolve?domain=vtorn_bot&start=login');
    expect(b.webUrl).toBe('https://t.me/vtorn_bot?start=login');
    expect(b.prefill).toBe('log in');
  });

  it('whatsapp — returns wa.me URL with prefilled text', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/v1/auth/dm-otp/start-info?channel=whatsapp',
    });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.webUrl).toBe('https://wa.me/64210000000?text=log%20in');
    expect(b.prefillsMessage).toBe(true);
  });

  it('messenger — returns m.me URL', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/v1/auth/dm-otp/start-info?channel=messenger',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().webUrl).toBe('https://m.me/vtorn?ref=login');
  });

  it('instagram — returns ig.me URL', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/v1/auth/dm-otp/start-info?channel=instagram',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().webUrl).toBe('https://ig.me/m/vtorn?ref=login');
  });
});

describe('infra', () => {
  it('GET / returns service descriptor', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe('vtourn-dm-otp');
  });
  it('GET /healthz 200', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
