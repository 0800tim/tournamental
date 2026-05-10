import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { CursorStore } from '../src/lib/cursors.js';
import { DeadLetterQueue } from '../src/lib/dead-letter.js';
import { Forwarder } from '../src/lib/forwarder.js';
import { Scheduler } from '../src/lib/scheduler.js';
import { MockPoller } from '../src/pollers/mock.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(resolve(tmpdir(), 'scheduler-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function mkScheduler(opts?: { failingForward?: boolean }) {
  const cursors = new CursorStore({ path: resolve(dir, 'cursors.jsonl') });
  const dl = new DeadLetterQueue(resolve(dir, 'failed.jsonl'));
  const fakeFetch = opts?.failingForward
    ? vi.fn().mockResolvedValue(new Response('err', { status: 500 }))
    : vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
  const forwarder = new Forwarder({
    baseUrl: 'http://dm-otp',
    bearer: 'sec',
    fetch: fakeFetch as unknown as typeof fetch,
    sleep: async () => {},
    maxRetries: 1,
    deadLetter: dl,
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
  return { scheduler, cursors, dl, reddit, mastodon, signal, fakeFetch };
}

describe('Scheduler', () => {
  it('forwards new messages and advances cursor', async () => {
    const { scheduler, cursors, reddit, fakeFetch } = mkScheduler();
    reddit.enqueue({ id: 1, externalId: 'alice', text: 'log in' });
    reddit.enqueue({ id: 2, externalId: 'bob', text: 'log in' });
    await scheduler.runOnce('reddit');
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    expect(cursors.get('reddit')).toBe('2');
  });

  it('does not redeliver already-forwarded messages on second poll', async () => {
    const { scheduler, cursors, reddit, fakeFetch } = mkScheduler();
    reddit.enqueue({ id: 1, externalId: 'alice', text: 'log in' });
    await scheduler.runOnce('reddit');
    expect(cursors.get('reddit')).toBe('1');
    reddit.enqueue({ id: 2, externalId: 'bob', text: 'log in' });
    await scheduler.runOnce('reddit');
    expect(fakeFetch).toHaveBeenCalledTimes(2); // 1 from first, 1 from second
    expect(cursors.get('reddit')).toBe('2');
  });

  it('halts cursor advance on forward failure (idempotency guarantee)', async () => {
    const { scheduler, cursors, reddit, dl } = mkScheduler({ failingForward: true });
    reddit.enqueue({ id: 1, externalId: 'alice', text: 'log in' });
    reddit.enqueue({ id: 2, externalId: 'bob', text: 'log in' });
    await scheduler.runOnce('reddit');
    expect(cursors.get('reddit')).toBeUndefined();
    expect(await dl.size()).toBe(1);
  });

  it('honours pause/resume', async () => {
    const { scheduler, cursors, reddit } = mkScheduler();
    reddit.enqueue({ id: 1, externalId: 'alice', text: 'log in' });
    scheduler.pause('reddit');
    await scheduler.runOnce('reddit');
    expect(cursors.get('reddit')).toBeUndefined();
    scheduler.resume('reddit');
    await scheduler.runOnce('reddit');
    expect(cursors.get('reddit')).toBe('1');
  });

  it('records lastError when poller throws', async () => {
    const { scheduler, reddit } = mkScheduler();
    reddit.setFailing(true);
    await scheduler.runOnce('reddit');
    const status = scheduler.status('reddit');
    expect(status?.lastPollOk).toBe(false);
    expect(status?.lastError).toMatch(/simulated/);
  });

  it('reports per-channel status after a successful poll', async () => {
    const { scheduler, reddit, mastodon, signal } = mkScheduler();
    reddit.enqueue({ id: 1, externalId: 'alice', text: 'log in' });
    await scheduler.runOnce('reddit');
    await scheduler.runOnce('mastodon');
    await scheduler.runOnce('signal');
    const all = scheduler.allStatus();
    expect(all.map((s) => s.channel).sort()).toEqual(['mastodon', 'reddit', 'signal']);
    const r = all.find((s) => s.channel === 'reddit')!;
    expect(r.lastPollOk).toBe(true);
    expect(r.lastPollMessages).toBe(1);
    expect(r.cursor).toBe('1');
  });

  it('skips overlapping cycles (concurrency=1 per channel)', async () => {
    const { scheduler, reddit } = mkScheduler();
    let resolveFirst!: () => void;
    let polls = 0;
    const slow = new MockPoller('reddit');
    slow.poll = async () => {
      polls += 1;
      await new Promise<void>((r) => {
        resolveFirst = r;
      });
      return { messages: [], cursor: undefined };
    };
    // Hot-swap the poller into the scheduler.
    void reddit;
    (scheduler as unknown as { states: Map<string, { entry: { poller: MockPoller } }> })
      .states.get('reddit')!.entry.poller = slow;
    const a = scheduler.runOnce('reddit');
    const b = scheduler.runOnce('reddit'); // should no-op
    resolveFirst();
    await a;
    await b;
    expect(polls).toBe(1);
  });

  it('start() schedules timers; stop() clears them', async () => {
    const setIntervalSpy = vi.fn().mockReturnValue({ unref: () => {} } as unknown as NodeJS.Timeout);
    const clearIntervalSpy = vi.fn();
    const cursors = new CursorStore({ path: resolve(dir, 'cursors.jsonl') });
    const fakeFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const forwarder = new Forwarder({
      baseUrl: 'http://x',
      bearer: 's',
      fetch: fakeFetch as unknown as typeof fetch,
    });
    const reddit = new MockPoller('reddit');
    const sched = new Scheduler({
      entries: [{ poller: reddit, intervalMs: 100 }],
      cursors,
      forwarder,
      timers: {
        setInterval: setIntervalSpy as unknown as typeof setInterval,
        clearInterval: clearIntervalSpy as unknown as typeof clearInterval,
      },
    });
    sched.start();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    await sched.stop();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
