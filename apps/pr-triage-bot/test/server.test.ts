import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index.js';

describe('pr-triage-bot HTTP server', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /healthz returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('GET /v1/version returns name+version', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/version' });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('@vtorn/pr-triage-bot');
  });

  it('POST /v1/triage rejects invalid payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/triage',
      payload: { pr: { number: 'not-a-number' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_input');
  });

  it('POST /v1/triage returns a verdict for valid payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/triage',
      payload: {
        pr: {
          number: 1,
          title: 'docs: tweak',
          body: '',
          author: 'someone',
          authorAssociation: 'CONTRIBUTOR',
          baseRef: 'main',
          headSha: 'abcdef0',
          draft: false,
        },
        files: [
          { path: 'docs/notes.md', status: 'modified', additions: 1, deletions: 0 },
        ],
        networkHosts: [],
        newEnvVars: [],
        newDeps: [],
        externalFlags: [],
        promptInjectionHits: [],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().verdict).toBe('green');
  });
});
