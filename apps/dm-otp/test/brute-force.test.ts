/**
 * Tests for the dm-otp brute-force defence: per-subject lockout +
 * per-IP throttle layered in front of `CodeStore.verify`.
 */

import { describe, it, expect } from 'vitest';
import {
  BruteForceGuard,
  DEFAULT_BRUTE_FORCE_CONFIG,
} from '../src/lib/brute-force.js';

describe('BruteForceGuard', () => {
  it('allows the first verify for a fresh subject + IP', () => {
    const g = new BruteForceGuard();
    expect(
      g.check({ channel: 'discord', externalId: 'user-1', ip: '203.0.113.1' })
        .ok,
    ).toBe(true);
  });

  it('locks a subject after 5 failures inside the window', () => {
    const now = { v: 1_000_000_000_000 };
    const g = new BruteForceGuard({ now: () => now.v });
    for (let i = 0; i < 4; i++) {
      const r = g.recordSubjectFailure({
        channel: 'discord',
        externalId: 'user-1',
      });
      expect(r.locked).toBe(false);
      now.v += 1000;
    }
    const last = g.recordSubjectFailure({
      channel: 'discord',
      externalId: 'user-1',
    });
    expect(last.locked).toBe(true);

    const r = g.check({
      channel: 'discord',
      externalId: 'user-1',
      ip: '203.0.113.1',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('subject-locked');
      expect(r.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it('lockout expires after the configured duration', () => {
    const now = { v: 1_000_000_000_000 };
    const g = new BruteForceGuard({ now: () => now.v });
    for (let i = 0; i < 5; i++) {
      g.recordSubjectFailure({ channel: 'x', externalId: 'u' });
    }
    expect(
      g.check({ channel: 'x', externalId: 'u', ip: '1.1.1.1' }).ok,
    ).toBe(false);

    now.v += DEFAULT_BRUTE_FORCE_CONFIG.subjectLockoutMs + 1000;
    expect(
      g.check({ channel: 'x', externalId: 'u', ip: '1.1.1.1' }).ok,
    ).toBe(true);
  });

  it('clearSubject wipes lockout + failure history', () => {
    const g = new BruteForceGuard();
    for (let i = 0; i < 5; i++) {
      g.recordSubjectFailure({ channel: 'x', externalId: 'u' });
    }
    expect(g.check({ channel: 'x', externalId: 'u', ip: 'a' }).ok).toBe(false);
    g.clearSubject({ channel: 'x', externalId: 'u' });
    expect(g.check({ channel: 'x', externalId: 'u', ip: 'a' }).ok).toBe(true);
  });

  it('throttles an IP at 30 attempts per 5-min window across many subjects', () => {
    const g = new BruteForceGuard();
    const ip = '203.0.113.99';
    for (let i = 0; i < DEFAULT_BRUTE_FORCE_CONFIG.ipMaxPerWindow; i++) {
      g.recordIpAttempt(ip);
    }
    const r = g.check({
      channel: 'discord',
      externalId: `id-${Math.random()}`,
      ip,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('ip-throttled');
  });

  it('IP window slides forward after expiry', () => {
    const now = { v: 1_000_000_000_000 };
    const g = new BruteForceGuard({ now: () => now.v });
    const ip = '1.2.3.4';
    for (let i = 0; i < DEFAULT_BRUTE_FORCE_CONFIG.ipMaxPerWindow; i++) {
      g.recordIpAttempt(ip);
    }
    expect(g.check({ channel: 'c', externalId: 'e', ip }).ok).toBe(false);

    now.v += DEFAULT_BRUTE_FORCE_CONFIG.ipWindowMs + 1;
    expect(g.check({ channel: 'c', externalId: 'e', ip }).ok).toBe(true);
  });

  it('different IPs do not share the bucket', () => {
    const g = new BruteForceGuard();
    for (let i = 0; i < DEFAULT_BRUTE_FORCE_CONFIG.ipMaxPerWindow; i++) {
      g.recordIpAttempt('1.1.1.1');
    }
    expect(g.check({ channel: 'c', externalId: 'e', ip: '2.2.2.2' }).ok).toBe(
      true,
    );
  });

  it('prune drops stale subject + IP entries', () => {
    const now = { v: 1_000_000_000_000 };
    const g = new BruteForceGuard({ now: () => now.v });
    g.recordIpAttempt('1.1.1.1');
    g.recordSubjectFailure({ channel: 'x', externalId: 'u' });

    expect(g.size().ips).toBe(1);
    expect(g.size().subjects).toBe(1);

    now.v +=
      Math.max(
        DEFAULT_BRUTE_FORCE_CONFIG.ipWindowMs,
        DEFAULT_BRUTE_FORCE_CONFIG.subjectFailureWindowMs,
      ) + 1;
    g.prune();
    expect(g.size().ips).toBe(0);
    expect(g.size().subjects).toBe(0);
  });
});

describe('verify route integration', () => {
  // We exercise the verify route end-to-end through buildServer in the
  // existing routes.test.ts. Here we just confirm the guard wires into
  // the route's response shape when triggered directly.
  it('subject lockout sets retry-after header + 429 + reason', async () => {
    const { BruteForceGuard: G } = await import('../src/lib/brute-force.js');
    const { buildServer } = await import('../src/index.js');
    const { CodeStore } = await import('../src/lib/code-store.js');
    const { IdentityStore } = await import('../src/lib/identity-store.js');
    const SECRET = 'a-test-secret-of-at-least-32-chars-1234';
    const bruteForce = new G();
    // Pre-lock the subject.
    for (let i = 0; i < 5; i++) {
      bruteForce.recordSubjectFailure({
        channel: 'discord',
        externalId: 'user-A',
      });
    }
    const app = await buildServer({
      ctx: {
        store: new CodeStore({ secret: SECRET }),
        identityStore: new IdentityStore(),
        senders: new Map(),
        bruteForce,
        magicLinkChannels: new Set(['email']),
        config: {
          otpSecret: SECRET,
          jwtSecret: SECRET,
          productName: 'Tournamental',
          appHost: 'tournamental.com',
          appBaseUrl: 'https://tournamental.com',
          codeTtlSeconds: 300,
          sessionTtlSeconds: 3600,
          metaAppSecret: '',
          telegramBotToken: '',
          telegramWebhookSecret: '',
          discordPublicKey: '',
          slackSigningSecret: '',
          lineChannelSecret: '',
          viberAuthToken: '',
          xConsumerSecret: '',
          mailgunSigningKey: '',
          mastodonInboundBearer: '',
          redditPollerBearer: '',
          signalPollerBearer: '',
          teamsAppId: '',
          teamsAppPassword: '',
          enabledChannels: '',
        },
        log: { info: () => {}, warn: () => {}, error: () => {} },
        now: () => Date.now(),
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/verify',
      payload: { channel: 'discord', externalId: 'user-A', code: '123456' },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe('subject-locked');
    expect(res.headers['retry-after']).toBeDefined();
    await app.close();
  });
});
