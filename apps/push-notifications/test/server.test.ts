/**
 * End-to-end-ish tests for the push-notifications service.
 *
 * Each test uses Fastify's `inject` to call routes without binding a port.
 * The audit log and subscription store are pointed at temp paths so tests
 * are isolated and runnable in parallel forks.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildServer, type BuiltServer } from '../src/index.js';

let workdir: string;
let built: BuiltServer;

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'push-test-'));
  built = await buildServer({
    auditPath: join(workdir, 'audit.jsonl'),
    subscriptionsPath: join(workdir, 'subs.jsonl'),
    schedulerStatePath: join(workdir, 'sched.json'),
    bootScheduler: false,
  });
  await built.app.ready();
});

afterEach(async () => {
  await built.app.close();
  await rm(workdir, { recursive: true, force: true });
});

describe('healthz + version', () => {
  it('reports healthy and exposes the version + pending counts', async () => {
    const h = await built.app.inject({ method: 'GET', url: '/healthz' });
    expect(h.statusCode).toBe(200);
    expect(h.json()).toMatchObject({ status: 'ok' });

    const v = await built.app.inject({ method: 'GET', url: '/v1/version' });
    expect(v.statusCode).toBe(200);
    const body = v.json();
    expect(body.service).toBe('vtorn-push-notifications');
    expect(body.version).toBe('0.1.0');
    expect(typeof body.pendingJobs).toBe('number');
  });
});

describe('subscribe endpoints', () => {
  it('rejects web-push subscribe without consent', async () => {
    const r = await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/web-push',
      payload: {
        userId: 'u1',
        consent: false,
        subscription: {
          endpoint: 'https://push.example/abc',
          keys: { p256dh: 'p', auth: 'a' },
        },
      },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_body');
  });

  it('accepts valid web-push subscription', async () => {
    const r = await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/web-push',
      payload: {
        userId: 'u1',
        consent: true,
        subscription: {
          endpoint: 'https://push.example/abc',
          keys: { p256dh: 'p256-key-data', auth: 'auth-key-data' },
        },
      },
    });
    expect(r.statusCode).toBe(201);
    expect(built.store.getWebPush('u1')).toBeDefined();
  });

  it('accepts valid telegram subscription', async () => {
    const r = await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/telegram',
      payload: { userId: 'u1', consent: true, telegramUserId: '12345' },
    });
    expect(r.statusCode).toBe(201);
    expect(built.store.getTelegram('u1')?.telegramUserId).toBe('12345');
  });

  it('accepts valid SMS subscription and normalises to E.164', async () => {
    const r = await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/sms',
      payload: { userId: 'u1', consent: true, phone: '+64211234567' },
    });
    expect(r.statusCode).toBe(201);
    expect(built.store.getSms('u1')?.phone).toBe('+64211234567');
  });

  it('rejects SMS subscribe without consent', async () => {
    const r = await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/sms',
      payload: { userId: 'u1', consent: false, phone: '+64211234567' },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('notify endpoints', () => {
  beforeEach(async () => {
    // Subscribe one user across all three channels.
    await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/web-push',
      payload: {
        userId: 'u1',
        consent: true,
        subscription: {
          endpoint: 'https://push.example/u1',
          keys: { p256dh: 'p256-key', auth: 'auth-key' },
        },
      },
    });
    await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/telegram',
      payload: { userId: 'u1', consent: true, telegramUserId: '111' },
    });
    await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/sms',
      payload: { userId: 'u1', consent: true, phone: '+64211111111' },
    });

    // Subscribe a second user with telegram only.
    await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/telegram',
      payload: { userId: 'u2', consent: true, telegramUserId: '222' },
    });

    // Record picks: u1 picks home_win, u2 picks draw.
    await built.app.inject({
      method: 'POST',
      url: '/v1/picks/record',
      payload: { matchId: 'M1', userId: 'u1', outcome: 'home_win' },
    });
    await built.app.inject({
      method: 'POST',
      url: '/v1/picks/record',
      payload: { matchId: 'M1', userId: 'u2', outcome: 'draw' },
    });
  });

  it('kickoff_soon fans out to every channel for every picker', async () => {
    const r = await built.app.inject({
      method: 'POST',
      url: '/v1/notify/kickoff_soon',
      payload: { matchId: 'M1', minutesUntil: 30 },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.recipients).toBe(2);
    const u1 = body.fanouts.find((f: { userId: string }) => f.userId === 'u1');
    expect(u1).toMatchObject({
      webPush: 'sent',
      telegram: 'sent',
      sms: 'sent',
    });
    const u2 = body.fanouts.find((f: { userId: string }) => f.userId === 'u2');
    expect(u2).toMatchObject({
      telegram: 'sent',
      webPush: 'skipped',
      sms: 'skipped',
    });
  });

  it('match_result distinguishes winners and losers', async () => {
    const r = await built.app.inject({
      method: 'POST',
      url: '/v1/notify/match_result',
      payload: {
        matchId: 'M1',
        outcome: 'home_win',
        scoreboard: '2-1',
        pointsForWin: 7,
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.recipients).toBe(2);
    expect(body.winners).toBe(1);

    const audit = await built.audit.read();
    const winRecords = audit.filter(
      (a) => a.event === 'match_result' && a.userId === 'u1',
    );
    expect(winRecords.length).toBeGreaterThan(0);
    const winPayload = winRecords[0]?.payload as { body?: string };
    expect(JSON.stringify(winPayload)).toMatch(/got it right/i);

    const lossRecords = audit.filter(
      (a) => a.event === 'match_result' && a.userId === 'u2',
    );
    expect(lossRecords.length).toBeGreaterThan(0);
    const lossPayload = lossRecords[0]?.payload as { body?: string };
    expect(JSON.stringify(lossPayload)).toMatch(/tough luck/i);
  });

  it('leaderboard_move skips below-threshold deltas', async () => {
    const r = await built.app.inject({
      method: 'POST',
      url: '/v1/notify/leaderboard_move',
      payload: {
        userId: 'u1',
        fromRank: 50,
        toRank: 48,
        tournamentId: 'fifa-wc-2026',
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.skipped).toBe(true);
    expect(body.reason).toBe('delta_below_threshold');
  });

  it('leaderboard_move fires on >=5 place jump', async () => {
    const r = await built.app.inject({
      method: 'POST',
      url: '/v1/notify/leaderboard_move',
      payload: {
        userId: 'u1',
        fromRank: 50,
        toRank: 30,
        tournamentId: 'fifa-wc-2026',
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.skipped).toBeUndefined();
    expect(body.fanout.userId).toBe('u1');
  });

  it('rejects notify when an internal secret is configured and missing', async () => {
    await built.app.close();
    built = await buildServer({
      auditPath: join(workdir, 'audit2.jsonl'),
      subscriptionsPath: join(workdir, 'subs2.jsonl'),
      schedulerStatePath: join(workdir, 'sched2.json'),
      bootScheduler: false,
      internalSecret: 'top-secret',
    });
    await built.app.ready();

    const r = await built.app.inject({
      method: 'POST',
      url: '/v1/notify/kickoff_soon',
      payload: { matchId: 'M1', minutesUntil: 5 },
    });
    expect(r.statusCode).toBe(401);

    const ok = await built.app.inject({
      method: 'POST',
      url: '/v1/notify/kickoff_soon',
      headers: { 'x-push-secret': 'top-secret' },
      payload: { matchId: 'M1', minutesUntil: 5 },
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe('audit log', () => {
  it('records subscribe events and a stub send note', async () => {
    await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/sms',
      payload: { userId: 'u9', consent: true, phone: '+64210000000' },
    });
    await built.app.inject({
      method: 'POST',
      url: '/v1/picks/record',
      payload: { matchId: 'X1', userId: 'u9', outcome: 'home_win' },
    });
    await built.app.inject({
      method: 'POST',
      url: '/v1/notify/kickoff_soon',
      payload: { matchId: 'X1', minutesUntil: 5 },
    });
    const records = await built.audit.read();
    const subscribe = records.find((r) => r.event === 'subscribe');
    expect(subscribe).toBeDefined();
    const send = records.find(
      (r) => r.event === 'kickoff_soon' && r.channel === 'sms',
    );
    expect(send).toBeDefined();
    expect(send?.note).toMatch(/stub/i);
  });
});
