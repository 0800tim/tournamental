import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import Fastify from 'fastify';
import sensible from '@fastify/sensible';

import { CursorStore } from '../src/lib/cursors.js';
import { DeadLetterQueue } from '../src/lib/dead-letter.js';
import { Forwarder } from '../src/lib/forwarder.js';
import { Scheduler } from '../src/lib/scheduler.js';
import { MockPoller } from '../src/pollers/mock.js';
import { registerControlRoutes } from '../src/routes/control.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(resolve(tmpdir(), 'control-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const ADMIN = 'admin-token-32-chars-aaaaaaaaaaaaaaaaaa';

async function buildFixture() {
  const cursors = new CursorStore({ path: resolve(dir, 'cursors.jsonl') });
  await cursors.load();
  const dl = new DeadLetterQueue(resolve(dir, 'failed.jsonl'));
  const fakeFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
  const forwarder = new Forwarder({
    baseUrl: 'http://dm-otp',
    bearer: 's',
    fetch: fakeFetch as unknown as typeof fetch,
  });
  const reddit = new MockPoller('reddit');
  const mastodon = new MockPoller('mastodon');
  const signal = new MockPoller('signal');
  const scheduler = new Scheduler({
    entries: [
      { poller: reddit, intervalMs: 1_000 },
      { poller: mastodon, intervalMs: 1_000 },
      { poller: signal, intervalMs: 1_000 },
    ],
    cursors,
    forwarder,
  });
  const app = Fastify({ logger: false });
  await app.register(sensible);
  await registerControlRoutes(app, {
    scheduler,
    forwarder,
    deadLetter: dl,
    adminToken: ADMIN,
    version: '0.1.0',
  });
  await app.ready();
  return { app, scheduler, dl, fakeFetch, reddit };
}

describe('control endpoints', () => {
  it('GET /healthz returns ok', async () => {
    const { app } = await buildFixture();
    const r = await app.inject({ method: 'GET', url: '/healthz' });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('ok');
    await app.close();
  });

  it('GET /v1/version returns service info', async () => {
    const { app } = await buildFixture();
    const r = await app.inject({ method: 'GET', url: '/v1/version' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.service).toBe('vtorn-dm-poll-forwarder');
    expect(body.channels).toEqual(['reddit', 'mastodon', 'signal']);
    await app.close();
  });

  it('GET /v1/status returns one row per channel', async () => {
    const { app, scheduler, reddit } = await buildFixture();
    reddit.enqueue({ id: 1, externalId: 'alice', text: 'log in' });
    await scheduler.runOnce('reddit');
    const r = await app.inject({ method: 'GET', url: '/v1/status' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.channels).toHaveLength(3);
    const red = body.channels.find((c: { channel: string }) => c.channel === 'reddit');
    expect(red.lastPollOk).toBe(true);
    expect(red.cursor).toBe('1');
    await app.close();
  });

  it('admin pause requires x-poll-admin header', async () => {
    const { app } = await buildFixture();
    const bad = await app.inject({ method: 'POST', url: '/v1/admin/pause/reddit' });
    expect(bad.statusCode).toBe(401);
    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/admin/pause/reddit',
      headers: { 'x-poll-admin': 'nope' },
    });
    expect(wrong.statusCode).toBe(401);
    await app.close();
  });

  it('admin pause/resume toggles scheduler state', async () => {
    const { app, scheduler } = await buildFixture();
    const pause = await app.inject({
      method: 'POST',
      url: '/v1/admin/pause/reddit',
      headers: { 'x-poll-admin': ADMIN },
    });
    expect(pause.statusCode).toBe(200);
    expect(scheduler.status('reddit')?.paused).toBe(true);
    const resume = await app.inject({
      method: 'POST',
      url: '/v1/admin/resume/reddit',
      headers: { 'x-poll-admin': ADMIN },
    });
    expect(resume.statusCode).toBe(200);
    expect(scheduler.status('reddit')?.paused).toBe(false);
    await app.close();
  });

  it('admin pause rejects unknown channels', async () => {
    const { app } = await buildFixture();
    const r = await app.inject({
      method: 'POST',
      url: '/v1/admin/pause/discord',
      headers: { 'x-poll-admin': ADMIN },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it('replay-failed re-attempts dead-letter entries', async () => {
    const { app, dl, fakeFetch } = await buildFixture();
    await dl.push({
      channel: 'reddit',
      message: { channel: 'reddit', externalId: 'alice', text: 'log in', cursor: 'c1' },
      attempts: 3,
      lastStatus: 503,
      lastError: 'http-503',
      enqueuedAt: Date.now(),
    });
    await dl.push({
      channel: 'signal',
      message: { channel: 'signal', externalId: '+1', text: 'log in', cursor: 'c2' },
      attempts: 3,
      lastStatus: 503,
      lastError: 'http-503',
      enqueuedAt: Date.now(),
    });
    const r = await app.inject({
      method: 'POST',
      url: '/v1/admin/replay-failed',
      headers: { 'x-poll-admin': ADMIN },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.replayed).toBe(2);
    expect(body.failed).toBe(0);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    expect(await dl.size()).toBe(0);
    await app.close();
  });

  it('replay-failed keeps entries that still fail', async () => {
    const cursors = new CursorStore({ path: resolve(dir, 'cursors.jsonl') });
    await cursors.load();
    const dl = new DeadLetterQueue(resolve(dir, 'failed.jsonl'));
    const fakeFetch = vi.fn().mockResolvedValue(new Response('still bad', { status: 503 }));
    const forwarder = new Forwarder({
      baseUrl: 'http://dm-otp',
      bearer: 's',
      fetch: fakeFetch as unknown as typeof fetch,
      sleep: async () => {},
      maxRetries: 0,
      deadLetter: dl,
    });
    const scheduler = new Scheduler({
      entries: [{ poller: new MockPoller('reddit'), intervalMs: 1_000 }],
      cursors,
      forwarder,
    });
    const app = Fastify({ logger: false });
    await app.register(sensible);
    await registerControlRoutes(app, {
      scheduler,
      forwarder,
      deadLetter: dl,
      adminToken: ADMIN,
      version: '0.1.0',
    });
    await dl.push({
      channel: 'reddit',
      message: { channel: 'reddit', externalId: 'alice', text: 'log in', cursor: 'c1' },
      attempts: 3,
      lastStatus: 503,
      lastError: 'http-503',
      enqueuedAt: Date.now(),
    });
    const r = await app.inject({
      method: 'POST',
      url: '/v1/admin/replay-failed',
      headers: { 'x-poll-admin': ADMIN },
    });
    const body = r.json();
    expect(body.replayed).toBe(0);
    expect(body.failed).toBe(1);
    expect(await dl.size()).toBe(1);
    await app.close();
  });
});
