/**
 * SubscriptionStore unit tests — JSONL round-trip + tombstone replay.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SubscriptionStore } from '../src/lib/subscriptions.js';

let workdir: string;
let path: string;

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'sub-test-'));
  path = join(workdir, 'subs.jsonl');
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

describe('SubscriptionStore', () => {
  it('round-trips three channels via JSONL', async () => {
    const a = SubscriptionStore.memory();
    await a.useFile(path);

    await a.upsertWebPush('u1', {
      endpoint: 'https://push.example/u1',
      keys: { p256dh: 'p', auth: 'a' },
    });
    await a.upsertTelegram('u1', '12345');
    await a.upsertSms('u1', '64211234567');

    const b = SubscriptionStore.memory();
    await b.useFile(path);
    expect(b.getWebPush('u1')?.subscription.endpoint).toBe(
      'https://push.example/u1',
    );
    expect(b.getTelegram('u1')?.telegramUserId).toBe('12345');
    expect(b.getSms('u1')?.phone).toBe('+64211234567');
  });

  it('tombstones a subscription on remove', async () => {
    const a = SubscriptionStore.memory();
    await a.useFile(path);
    await a.upsertSms('u1', '+64211111111');
    expect(a.getSms('u1')).toBeDefined();
    const removed = await a.remove('u1', 'sms');
    expect(removed).toBe(true);
    expect(a.getSms('u1')).toBeUndefined();

    const b = SubscriptionStore.memory();
    await b.useFile(path);
    expect(b.getSms('u1')).toBeUndefined();
  });

  it('round-trips native subscriptions', async () => {
    const a = SubscriptionStore.memory();
    await a.useFile(path);
    const token = 'a'.repeat(64);
    await a.upsertNative('u1', 'ios', token);

    const b = SubscriptionStore.memory();
    await b.useFile(path);
    const rec = b.getNative('u1');
    expect(rec).toBeDefined();
    expect(rec?.platform).toBe('ios');
    expect(rec?.token).toBe(token);
  });

  it('lists picks per match', async () => {
    const a = SubscriptionStore.memory();
    await a.useFile(path);
    await a.recordPick('M1', 'u1', 'home_win');
    await a.recordPick('M1', 'u2', 'draw');
    await a.recordPick('M2', 'u1', 'away_win');
    expect(a.picksForMatch('M1').length).toBe(2);
    expect(a.picksForMatch('M2').length).toBe(1);
    expect(a.picksForMatch('M3').length).toBe(0);

    const b = SubscriptionStore.memory();
    await b.useFile(path);
    expect(b.picksForMatch('M1').length).toBe(2);
  });
});
