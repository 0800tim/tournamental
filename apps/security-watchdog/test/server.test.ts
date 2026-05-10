import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index.js';
import { WatchdogStore } from '../src/lib/storage.js';
import { AlertDispatcher } from '../src/alerts/index.js';

const TOKEN = 'this-is-a-32-char-test-token-xx';

describe('security-watchdog HTTP', () => {
  let app: FastifyInstance;
  let store: WatchdogStore;

  beforeAll(async () => {
    process.env.WATCHDOG_API_TOKEN = TOKEN;
    store = new WatchdogStore({
      findingsPath: '/tmp/_unused.jsonl',
      auditPath: '/tmp/_unused-audit.jsonl',
      ephemeral: true,
    });
    const dispatcher = new AlertDispatcher({ sinks: [] });
    app = await buildServer({ store, dispatcher });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    // Clean store between tests
    for (const f of store.list()) {
      store.setStatus(f.id, 'resolved', 'test');
    }
  });

  it('GET /healthz works', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /v1/findings returns empty list initially', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/findings?status=open' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
  });

  it('rejects unauthorised POST /v1/findings', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/findings',
      payload: validFinding(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts authorised POST /v1/findings and stores it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/findings',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: validFinding(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(true);
    expect(res.json().finding.id).toBe(validFinding().id);
  });

  it('rejects malformed POST /v1/findings', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/findings',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { junk: 'no' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('ack/resolve lifecycle works', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/findings',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: validFinding(),
    });
    const ack = await app.inject({
      method: 'POST',
      url: `/v1/findings/${validFinding().id}/ack`,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { by: 'tim', reason: 'looking' },
    });
    expect(ack.statusCode).toBe(200);
    expect(ack.json().finding.status).toBe('acknowledged');
    const resolve = await app.inject({
      method: 'POST',
      url: `/v1/findings/${validFinding().id}/resolve`,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { by: 'tim', reason: 'fixed' },
    });
    expect(resolve.statusCode).toBe(200);
    expect(resolve.json().finding.status).toBe('resolved');
  });

  it('GET unknown finding 404s', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/findings/no-such-id' });
    expect(res.statusCode).toBe(404);
  });

  it('audit-log requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/audit-log' });
    expect(res.statusCode).toBe(401);
  });
});

function validFinding() {
  return {
    id: 'gitleaks:test:1',
    source: 'gitleaks' as const,
    severity: 'high' as const,
    status: 'open' as const,
    title: 'AWS access key',
    detail: 'AKIA...',
    location: 'apps/x/src/y.ts:10',
    tags: ['secret'],
    firstSeenAt: 1_700_000_000_000,
    lastSeenAt: 1_700_000_000_000,
  };
}
