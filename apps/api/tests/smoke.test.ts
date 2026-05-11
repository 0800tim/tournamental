import { describe, it, expect, afterAll } from 'vitest';
import { buildServer } from '../src/server';

describe('vtorn-api smoke', () => {
  const appPromise = buildServer();
  afterAll(async () => {
    const app = await appPromise;
    await app.close();
  });

  it('GET / returns service descriptor', async () => {
    const app = await appPromise;
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.service).toBe('vtorn-api');
    expect(body.health).toBe('/health');
  });

  it('GET /health returns status:ok with no-store', async () => {
    const app = await appPromise;
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json().status).toBe('ok');
  });

  it('GET /v1/version returns spec_version 0.1.1', async () => {
    const app = await appPromise;
    const res = await app.inject({ method: 'GET', url: '/v1/version' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.service).toBe('@vtorn/api');
    expect(body.spec_version).toBe('0.1.1');
  });

  it('CORS allowlist enforced', async () => {
    const app = await appPromise;
    const ok = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        Origin: 'https://play.tournamental.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(ok.statusCode).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('https://play.tournamental.com');

    const blocked = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'GET',
      },
    });
    // CORS plugin returns 204 either way; key check is the allow-origin header is absent for non-allowlisted.
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });
});
