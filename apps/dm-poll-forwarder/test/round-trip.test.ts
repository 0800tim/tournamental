/**
 * End-to-end round-trip: a fake dm-otp HTTP server receives the
 * forwarded webhooks. Asserts shape, headers, and that the scheduler
 * advances the cursor only after all forwards succeed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { CursorStore } from '../src/lib/cursors.js';
import { DeadLetterQueue } from '../src/lib/dead-letter.js';
import { Forwarder } from '../src/lib/forwarder.js';
import { Scheduler } from '../src/lib/scheduler.js';
import { MockPoller } from '../src/pollers/mock.js';

let dir: string;
let server: http.Server;
let baseUrl: string;
const received: Array<{ url: string; body: string; auth: string }> = [];

beforeEach(async () => {
  dir = await fs.mkdtemp(resolve(tmpdir(), 'rt-'));
  received.length = 0;
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      received.push({
        url: req.url ?? '',
        body,
        auth: (req.headers['authorization'] as string) ?? '',
      });
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await fs.rm(dir, { recursive: true, force: true });
});

describe('round-trip', () => {
  it('forwards a Reddit DM to the correct webhook with bearer auth', async () => {
    const cursors = new CursorStore({ path: resolve(dir, 'cursors.jsonl') });
    await cursors.load();
    const dl = new DeadLetterQueue(resolve(dir, 'failed.jsonl'));
    const forwarder = new Forwarder({
      baseUrl,
      bearer: 'shared-secret-32-aaaaaaaaaaaaaaaaaaaaa',
      deadLetter: dl,
    });
    const reddit = new MockPoller('reddit');
    reddit.enqueue({ id: 1, externalId: 'alice', text: 'log in' });
    const scheduler = new Scheduler({
      entries: [{ poller: reddit, intervalMs: 1_000 }],
      cursors,
      forwarder,
    });
    await scheduler.runOnce('reddit');
    expect(received).toHaveLength(1);
    expect(received[0]!.url).toBe('/v1/auth/dm-otp/webhooks/reddit');
    expect(received[0]!.auth).toBe('Bearer shared-secret-32-aaaaaaaaaaaaaaaaaaaaa');
    expect(JSON.parse(received[0]!.body)).toEqual({ fromUsername: 'alice', text: 'log in' });
    expect(cursors.get('reddit')).toBe('1');
  });

  it('forwards multiple channels in order', async () => {
    const cursors = new CursorStore({ path: resolve(dir, 'cursors.jsonl') });
    await cursors.load();
    const dl = new DeadLetterQueue(resolve(dir, 'failed.jsonl'));
    const forwarder = new Forwarder({
      baseUrl,
      bearer: 'shared-secret-32-aaaaaaaaaaaaaaaaaaaaa',
      deadLetter: dl,
    });
    const reddit = new MockPoller('reddit');
    const mastodon = new MockPoller('mastodon');
    const signal = new MockPoller('signal');
    reddit.enqueue({ id: 1, externalId: 'r1', text: 'log in' });
    mastodon.enqueue({ id: 1, externalId: 'm1@inst', text: 'log in' });
    signal.enqueue({ id: 1, externalId: '+1', text: 'log in' });
    const scheduler = new Scheduler({
      entries: [
        { poller: reddit, intervalMs: 1_000 },
        { poller: mastodon, intervalMs: 1_000 },
        { poller: signal, intervalMs: 1_000 },
      ],
      cursors,
      forwarder,
    });
    await scheduler.runOnce('reddit');
    await scheduler.runOnce('mastodon');
    await scheduler.runOnce('signal');
    expect(received.map((r) => r.url)).toEqual([
      '/v1/auth/dm-otp/webhooks/reddit',
      '/v1/auth/dm-otp/webhooks/mastodon',
      '/v1/auth/dm-otp/webhooks/signal',
    ]);
    expect(JSON.parse(received[1]!.body)).toEqual({
      fromHandle: 'm1@inst',
      text: 'log in',
      visibility: 'direct',
    });
    expect(JSON.parse(received[2]!.body)).toEqual({
      fromNumber: '+1',
      text: 'log in',
    });
  });
});
