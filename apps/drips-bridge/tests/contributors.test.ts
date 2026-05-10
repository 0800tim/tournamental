import { describe, expect, it } from 'vitest';
import {
  ContributorStore,
  DistributionStore,
  computeSplits,
  isValidPeriod,
  round2dp,
} from '../src/lib/contributors.js';

describe('ContributorStore.register', () => {
  it('creates a new contributor when none exists', () => {
    const store = new ContributorStore({ path: ':memory:' });
    const { contributor, created } = store.register({
      githubLogin: 'alice',
      role: 'core',
      activeShares: 100,
    });
    expect(created).toBe(true);
    expect(contributor.githubLogin).toBe('alice');
    expect(contributor.role).toBe('core');
    expect(contributor.activeShares).toBe(100);
    expect(contributor.id).toMatch(/^c_[0-9a-f]{24}$/);
    expect(contributor.joinedAt).toMatch(/T/);
  });

  it('is idempotent on githubLogin (case-insensitive)', () => {
    const store = new ContributorStore({ path: ':memory:' });
    const first = store.register({ githubLogin: 'alice', activeShares: 50 });
    const second = store.register({ githubLogin: 'ALICE', activeShares: 999 });
    expect(second.created).toBe(false);
    expect(second.contributor.id).toBe(first.contributor.id);
    // Did NOT update activeShares because upsert defaulted to false.
    expect(second.contributor.activeShares).toBe(50);
  });

  it('upserts when upsert: true', () => {
    const store = new ContributorStore({ path: ':memory:' });
    store.register({ githubLogin: 'alice', activeShares: 50 });
    const second = store.register({
      githubLogin: 'alice',
      activeShares: 200,
      role: 'founder',
      upsert: true,
    });
    expect(second.created).toBe(false);
    expect(second.contributor.activeShares).toBe(200);
    expect(second.contributor.role).toBe('founder');
  });

  it('defaults role and shares correctly', () => {
    const store = new ContributorStore({ path: ':memory:' });
    const { contributor } = store.register({ githubLogin: 'bob' });
    expect(contributor.role).toBe('contributor');
    expect(contributor.activeShares).toBe(0);
    expect(contributor.displayName).toBe('bob');
  });
});

describe('ContributorStore.update', () => {
  it('updates ethAddress', () => {
    const store = new ContributorStore({ path: ':memory:' });
    const { contributor } = store.register({ githubLogin: 'alice' });
    const eth = '0x' + 'a'.repeat(40);
    const updated = store.update(contributor.id, { ethAddress: eth });
    expect(updated.ethAddress).toBe(eth);
  });

  it('rejects malformed ethAddress', () => {
    const store = new ContributorStore({ path: ':memory:' });
    const { contributor } = store.register({ githubLogin: 'alice' });
    expect(() =>
      store.update(contributor.id, { ethAddress: 'not-an-address' }),
    ).toThrow(/0x/);
  });

  it('rejects negative activeShares', () => {
    const store = new ContributorStore({ path: ':memory:' });
    const { contributor } = store.register({ githubLogin: 'alice' });
    expect(() => store.update(contributor.id, { activeShares: -5 })).toThrow(/>= 0/);
  });

  it('throws when contributor not found', () => {
    const store = new ContributorStore({ path: ':memory:' });
    expect(() => store.update('c_does_not_exist', { activeShares: 1 })).toThrow(/not found/);
  });
});

describe('ContributorStore listing', () => {
  it('lists in joinedAt order', async () => {
    const store = new ContributorStore({ path: ':memory:' });
    store.register({ githubLogin: 'first' });
    // Force a measurable timestamp gap so the sort is deterministic.
    await new Promise((r) => setTimeout(r, 5));
    store.register({ githubLogin: 'second' });
    const list = store.list();
    expect(list[0].githubLogin).toBe('first');
    expect(list[1].githubLogin).toBe('second');
  });

  it('counts correctly', () => {
    const store = new ContributorStore({ path: ':memory:' });
    expect(store.count()).toBe(0);
    store.register({ githubLogin: 'a' });
    store.register({ githubLogin: 'b' });
    expect(store.count()).toBe(2);
  });
});

describe('computeSplits', () => {
  it('splits proportionally to activeShares', () => {
    const store = new ContributorStore({ path: ':memory:' });
    const a = store.register({ githubLogin: 'a', activeShares: 30 }).contributor;
    const b = store.register({ githubLogin: 'b', activeShares: 70 }).contributor;
    const splits = computeSplits({
      contributors: [a, b],
      totalReceiptsUsd: 1000,
    });
    const aSplit = splits.find((s) => s.contributorId === a.id)!;
    const bSplit = splits.find((s) => s.contributorId === b.id)!;
    expect(aSplit.payoutUsd).toBe(300);
    expect(bSplit.payoutUsd).toBe(700);
    expect(aSplit.sharesAtSnapshot).toBe(30);
    expect(bSplit.sharesAtSnapshot).toBe(70);
  });

  it('skips contributors with zero shares', () => {
    const store = new ContributorStore({ path: ':memory:' });
    const a = store.register({ githubLogin: 'a', activeShares: 100 }).contributor;
    const b = store.register({ githubLogin: 'b', activeShares: 0 }).contributor;
    const splits = computeSplits({
      contributors: [a, b],
      totalReceiptsUsd: 500,
    });
    expect(splits).toHaveLength(1);
    expect(splits[0].contributorId).toBe(a.id);
    expect(splits[0].payoutUsd).toBe(500);
  });

  it('returns [] when no contributor has shares', () => {
    const splits = computeSplits({ contributors: [], totalReceiptsUsd: 1000 });
    expect(splits).toEqual([]);
  });

  it('returns [] when totalReceiptsUsd <= 0', () => {
    const store = new ContributorStore({ path: ':memory:' });
    const a = store.register({ githubLogin: 'a', activeShares: 100 }).contributor;
    expect(computeSplits({ contributors: [a], totalReceiptsUsd: 0 })).toEqual([]);
  });

  it('reconciles rounding remainder onto the largest-share contributor', () => {
    const store = new ContributorStore({ path: ':memory:' });
    // Three-way split of $100 with 1/2/3 shares — 1/6, 2/6, 3/6 of $100 has
    // rounding noise (16.67, 33.33, 50.00 = $100.00 exactly here, but the
    // remainder logic must still keep totals exact for awkward inputs).
    const a = store.register({ githubLogin: 'a', activeShares: 1 }).contributor;
    const b = store.register({ githubLogin: 'b', activeShares: 2 }).contributor;
    const c = store.register({ githubLogin: 'c', activeShares: 3 }).contributor;
    const splits = computeSplits({
      contributors: [a, b, c],
      totalReceiptsUsd: 100,
    });
    const sum = splits.reduce((acc, s) => acc + s.payoutUsd, 0);
    expect(round2dp(sum)).toBe(100);
    // The three-share contributor must be allocated the largest payout.
    const sortedByShares = [...splits].sort(
      (x, y) => y.sharesAtSnapshot - x.sharesAtSnapshot,
    );
    expect(sortedByShares[0].sharesAtSnapshot).toBe(3);
    expect(sortedByShares[0].payoutUsd).toBeGreaterThanOrEqual(
      sortedByShares[1].payoutUsd,
    );
  });

  it('handles awkward 1/3 splits exactly', () => {
    const store = new ContributorStore({ path: ':memory:' });
    const a = store.register({ githubLogin: 'a', activeShares: 1 }).contributor;
    const b = store.register({ githubLogin: 'b', activeShares: 1 }).contributor;
    const c = store.register({ githubLogin: 'c', activeShares: 1 }).contributor;
    const splits = computeSplits({
      contributors: [a, b, c],
      totalReceiptsUsd: 100,
    });
    const sum = splits.reduce((acc, s) => acc + s.payoutUsd, 0);
    expect(round2dp(sum)).toBe(100);
    // Two contributors get $33.33; one absorbs the $0.01 remainder → $33.34.
    const payouts = splits.map((s) => s.payoutUsd).sort();
    expect(payouts[0]).toBe(33.33);
    expect(payouts[1]).toBe(33.33);
    expect(payouts[2]).toBe(33.34);
  });
});

describe('DistributionStore', () => {
  it('creates and retrieves a distribution', () => {
    const store = new DistributionStore({ path: ':memory:' });
    const dist = store.create({
      period: '2026-05',
      totalReceiptsUsd: 1000,
      splits: [
        { contributorId: 'c_a', sharesAtSnapshot: 100, payoutUsd: 1000 },
      ],
    });
    expect(dist.id).toMatch(/^d_[0-9a-f]{24}$/);
    expect(dist.status).toBe('pending');
    expect(store.get(dist.id)).toEqual(dist);
  });

  it('updates status with txHash', () => {
    const store = new DistributionStore({ path: ':memory:' });
    const dist = store.create({
      period: '2026-05',
      totalReceiptsUsd: 1000,
      splits: [],
    });
    const updated = store.setStatus(dist.id, 'pushed', { txHash: '0xdeadbeef' });
    expect(updated.status).toBe('pushed');
    expect(updated.txHash).toBe('0xdeadbeef');
    expect(updated.updatedAt).toBeDefined();
  });

  it('lists newest first', async () => {
    const store = new DistributionStore({ path: ':memory:' });
    store.create({ period: '2026-04', totalReceiptsUsd: 100, splits: [] });
    await new Promise((r) => setTimeout(r, 5));
    store.create({ period: '2026-05', totalReceiptsUsd: 200, splits: [] });
    const list = store.list();
    expect(list[0].period).toBe('2026-05');
    expect(list[1].period).toBe('2026-04');
  });

  it('throws on missing distribution status update', () => {
    const store = new DistributionStore({ path: ':memory:' });
    expect(() => store.setStatus('d_missing', 'pushed')).toThrow(/not found/);
  });
});

describe('isValidPeriod', () => {
  it('accepts YYYY-MM with months 01-12', () => {
    expect(isValidPeriod('2026-01')).toBe(true);
    expect(isValidPeriod('2026-12')).toBe(true);
  });

  it('rejects invalid months', () => {
    expect(isValidPeriod('2026-00')).toBe(false);
    expect(isValidPeriod('2026-13')).toBe(false);
  });

  it('rejects malformed strings', () => {
    expect(isValidPeriod('2026/05')).toBe(false);
    expect(isValidPeriod('26-05')).toBe(false);
    expect(isValidPeriod('2026-5')).toBe(false);
    expect(isValidPeriod('')).toBe(false);
  });
});
