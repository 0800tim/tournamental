import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { Forwarder } from '../src/lib/forwarder.js';
import { DeadLetterQueue } from '../src/lib/dead-letter.js';
import type { PollMessage } from '../src/types.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(resolve(tmpdir(), 'forwarder-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const mkMessage = (channel: PollMessage['channel'], externalId: string): PollMessage => ({
  channel,
  externalId,
  text: 'log in',
  cursor: 'c1',
});

describe('Forwarder', () => {
  it('shapes reddit body as { fromUsername, text }', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const fwd = new Forwarder({
      baseUrl: 'http://dm-otp:3331',
      bearer: 'secret-32-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      fetch: fakeFetch as unknown as typeof fetch,
    });
    const res = await fwd.forward(mkMessage('reddit', 'alice'));
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(1);
    const [url, init] = fakeFetch.mock.calls[0]!;
    expect(url).toBe('http://dm-otp:3331/v1/auth/dm-otp/webhooks/reddit');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      fromUsername: 'alice',
      text: 'log in',
    });
  });

  it('shapes mastodon body with visibility=direct', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const fwd = new Forwarder({
      baseUrl: 'http://dm-otp:3331/',
      bearer: 's',
      fetch: fakeFetch as unknown as typeof fetch,
    });
    await fwd.forward(mkMessage('mastodon', 'a@masto.social'));
    const init = fakeFetch.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      fromHandle: 'a@masto.social',
      text: 'log in',
      visibility: 'direct',
    });
  });

  it('shapes signal body as { fromNumber, text }', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const fwd = new Forwarder({
      baseUrl: 'http://dm-otp:3331',
      bearer: 's',
      fetch: fakeFetch as unknown as typeof fetch,
    });
    await fwd.forward(mkMessage('signal', '+15551234567'));
    const init = fakeFetch.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      fromNumber: '+15551234567',
      text: 'log in',
    });
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer s');
  });

  it('retries with exponential backoff on 5xx', async () => {
    const calls: number[] = [];
    const fakeFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(new Response('boom', { status: 502 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const sleeps: number[] = [];
    const fwd = new Forwarder({
      baseUrl: 'http://dm-otp:3331',
      bearer: 's',
      fetch: fakeFetch as unknown as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      initialBackoffMs: 100,
    });
    const res = await fwd.forward(mkMessage('reddit', 'alice'));
    void calls;
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(3);
    expect(res.retried).toBe(true);
    expect(sleeps).toEqual([100, 200]);
  });

  it('retries on 429 then succeeds', async () => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const fwd = new Forwarder({
      baseUrl: 'http://dm-otp:3331',
      bearer: 's',
      fetch: fakeFetch as unknown as typeof fetch,
      sleep: async () => {},
      initialBackoffMs: 1,
    });
    const res = await fwd.forward(mkMessage('signal', '+1'));
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(2);
  });

  it('does not retry on 4xx (other than 429)', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(new Response('bad', { status: 400 }));
    const fwd = new Forwarder({
      baseUrl: 'http://dm-otp:3331',
      bearer: 's',
      fetch: fakeFetch as unknown as typeof fetch,
      sleep: async () => {},
    });
    const res = await fwd.forward(mkMessage('reddit', 'alice'));
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(1);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('dead-letters after exhausting retries', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(new Response('boom', { status: 503 }));
    const dl = new DeadLetterQueue(resolve(dir, 'failed.jsonl'));
    const fwd = new Forwarder({
      baseUrl: 'http://dm-otp:3331',
      bearer: 's',
      fetch: fakeFetch as unknown as typeof fetch,
      sleep: async () => {},
      deadLetter: dl,
      maxRetries: 2,
    });
    const res = await fwd.forward(mkMessage('reddit', 'alice'));
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(3);
    expect(res.deadLettered).toBe(true);
    expect(await dl.size()).toBe(1);
  });

  it('retries network errors and dead-letters when persistent', async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error('econnrefused'));
    const dl = new DeadLetterQueue(resolve(dir, 'failed.jsonl'));
    const fwd = new Forwarder({
      baseUrl: 'http://dm-otp:3331',
      bearer: 's',
      fetch: fakeFetch as unknown as typeof fetch,
      sleep: async () => {},
      deadLetter: dl,
      maxRetries: 1,
    });
    const res = await fwd.forward(mkMessage('signal', '+1'));
    expect(res.ok).toBe(false);
    expect(res.error).toBe('econnrefused');
    expect(res.attempts).toBe(2);
    expect(await dl.size()).toBe(1);
  });
});
