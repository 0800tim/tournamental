import { describe, it, expect } from 'vitest';
import { computeHumanness, PROVIDER_WEIGHTS } from '../src/lib/humanness.js';
import type { IdentityLinkRecord } from '../src/lib/storage.js';

const NOW = 1_700_000_000_000;

function link(
  provider: keyof typeof PROVIDER_WEIGHTS,
  overrides: Partial<IdentityLinkRecord> = {},
): IdentityLinkRecord {
  return {
    userId: 'u',
    provider,
    externalId: `ext_${provider}`,
    linkedAt: NOW - 1_000,
    lastSeenAt: NOW - 1_000,
    profile: {},
    ...overrides,
  };
}

describe('humanness scoring', () => {
  it('a brand-new user with no links scores 0', () => {
    const snap = computeHumanness({ userId: 'u', links: [], now: NOW });
    expect(snap.score).toBeLessThan(30);
    expect(snap.score).toBeGreaterThanOrEqual(0);
    // base contribution is gated on having at least one link.
    const base = snap.factors.find((f) => f.id === 'base');
    expect(base?.contribution).toBe(0);
  });

  it('a fresh user with only one weak link scores under 30', () => {
    const links = [link('x')];
    const snap = computeHumanness({ userId: 'u', links, now: NOW });
    expect(snap.score).toBeLessThan(30);
  });

  it('a user with 5 linked providers + good behaviour scores >80', () => {
    const links: IdentityLinkRecord[] = [
      link('google'),
      link('apple'),
      link('telegram', { profile: { telegramPremium: true } }),
      link('phone'),
      link('discord'),
    ];
    const snap = computeHumanness({
      userId: 'u',
      links,
      signals: {
        cadenceConsistency: 0.9,
        deviceStability: 0.95,
        captchaPassRate: 1,
        botLikelihood: 0,
      },
      now: NOW,
    });
    expect(snap.score).toBeGreaterThan(80);
    expect(snap.score).toBeLessThanOrEqual(100);
  });

  it('botLikelihood subtracts up to 25 points', () => {
    const links = [link('google'), link('apple'), link('phone')];
    const clean = computeHumanness({
      userId: 'u',
      links,
      signals: { cadenceConsistency: 0.9, deviceStability: 0.9, captchaPassRate: 1, botLikelihood: 0 },
      now: NOW,
    });
    const dirty = computeHumanness({
      userId: 'u',
      links,
      signals: { cadenceConsistency: 0.9, deviceStability: 0.9, captchaPassRate: 1, botLikelihood: 1 },
      now: NOW,
    });
    expect(clean.score - dirty.score).toBeGreaterThanOrEqual(20);
  });

  it('is deterministic — same inputs produce the same score', () => {
    const links = [link('google'), link('apple')];
    const a = computeHumanness({ userId: 'u', links, now: NOW });
    const b = computeHumanness({ userId: 'u', links, now: NOW });
    expect(a.score).toBe(b.score);
    expect(a.factors).toEqual(b.factors);
  });

  it('breakdown factors sum (clamped) match the score', () => {
    const links = [link('google'), link('phone')];
    const snap = computeHumanness({
      userId: 'u',
      links,
      signals: { cadenceConsistency: 0.5 },
      now: NOW,
    });
    const sum = snap.factors.reduce((a, f) => a + f.contribution, 0);
    expect(snap.score).toBe(Math.round(Math.max(0, Math.min(100, sum))));
  });

  it('telegram premium adds the documented bonus', () => {
    const without = computeHumanness({
      userId: 'u',
      links: [link('telegram', { profile: { telegramPremium: false } })],
      now: NOW,
    });
    const withPrem = computeHumanness({
      userId: 'u',
      links: [link('telegram', { profile: { telegramPremium: true } })],
      now: NOW,
    });
    expect(withPrem.score - without.score).toBe(3);
  });

  it('stale links lose freshness contribution', () => {
    const fresh = computeHumanness({
      userId: 'u',
      links: [link('google', { lastSeenAt: NOW - 1_000 })],
      now: NOW,
    });
    const stale = computeHumanness({
      userId: 'u',
      links: [link('google', { lastSeenAt: NOW - 90 * 24 * 60 * 60 * 1000 })],
      now: NOW,
    });
    const freshFactor = fresh.factors.find((f) => f.id === 'link_freshness')!;
    const staleFactor = stale.factors.find((f) => f.id === 'link_freshness')!;
    expect(freshFactor.contribution).toBeGreaterThan(staleFactor.contribution);
    expect(staleFactor.contribution).toBe(0);
  });
});
