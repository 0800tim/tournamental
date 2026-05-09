import { describe, it, expect } from 'vitest';

import { ClickStore, hashUserId } from '../src/storage';

describe('hashUserId', () => {
  it('is deterministic for (user_id, salt)', () => {
    const a = hashUserId('user-1', 'salt-1234567890abcd');
    const b = hashUserId('user-1', 'salt-1234567890abcd');
    expect(a).toBe(b);
  });

  it('differs across different user IDs with same salt', () => {
    const a = hashUserId('user-1', 'salt-1234567890abcd');
    const b = hashUserId('user-2', 'salt-1234567890abcd');
    expect(a).not.toBe(b);
  });

  it('differs across different salts with same user ID', () => {
    const a = hashUserId('user-1', 'salt-1234567890abcd');
    const b = hashUserId('user-1', 'salt-zyxwvutsrqponm0');
    expect(a).not.toBe(b);
  });

  it('returns a 64-char hex string', () => {
    const h = hashUserId('user-1', 'salt-1234567890abcd');
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it('throws if salt is too short', () => {
    expect(() => hashUserId('user-1', 'short')).toThrow(/at least 16/);
  });

  it('does not embed the raw user_id in the hash', () => {
    const h = hashUserId('SECRET-USER-ID-9999', 'salt-1234567890abcd');
    expect(h).not.toContain('SECRET');
    expect(h).not.toContain('9999');
  });
});

describe('ClickStore', () => {
  it('insert + recent round-trips', () => {
    const store = new ClickStore({ path: ':memory:' });
    const rec = store.insert({
      partner: 'polymarket',
      surface: 'bracket',
      country: 'US',
      match_id: null,
      team_code: null,
      user_id_hash: null,
      campaign_id: null,
      ts: 1_715_000_000,
    });
    expect(rec.id).toMatch(/^c_/);
    expect(store.count()).toBe(1);
    const [row] = store.recent(10);
    expect(row.partner).toBe('polymarket');
    expect(row.country).toBe('US');
    expect(row.ts).toBe(1_715_000_000);
    store.close();
  });

  it('countUserPartner counts only matching (user, partner)', () => {
    const store = new ClickStore({ path: ':memory:' });
    const ts = 1_715_000_000;
    const hashA = 'a'.repeat(64);
    const hashB = 'b'.repeat(64);
    store.insert({ partner: 'polymarket', surface: 'bracket', country: 'US', match_id: null, team_code: null, user_id_hash: hashA, campaign_id: null, ts });
    store.insert({ partner: 'polymarket', surface: 'bracket', country: 'US', match_id: null, team_code: null, user_id_hash: hashA, campaign_id: null, ts });
    store.insert({ partner: 'espn-plus', surface: 'bracket', country: 'US', match_id: null, team_code: null, user_id_hash: hashA, campaign_id: null, ts });
    store.insert({ partner: 'polymarket', surface: 'bracket', country: 'US', match_id: null, team_code: null, user_id_hash: hashB, campaign_id: null, ts });
    expect(store.countUserPartner(hashA, 'polymarket', 0)).toBe(2);
    expect(store.countUserPartner(hashA, 'espn-plus', 0)).toBe(1);
    expect(store.countUserPartner(hashB, 'polymarket', 0)).toBe(1);
    expect(store.countUserPartner(hashA, 'sky-nz', 0)).toBe(0);
    store.close();
  });

  it('countUserPartner respects sinceTs window', () => {
    const store = new ClickStore({ path: ':memory:' });
    const hash = 'c'.repeat(64);
    store.insert({ partner: 'polymarket', surface: 'bracket', country: 'US', match_id: null, team_code: null, user_id_hash: hash, campaign_id: null, ts: 1_000_000 });
    store.insert({ partner: 'polymarket', surface: 'bracket', country: 'US', match_id: null, team_code: null, user_id_hash: hash, campaign_id: null, ts: 2_000_000 });
    expect(store.countUserPartner(hash, 'polymarket', 0)).toBe(2);
    expect(store.countUserPartner(hash, 'polymarket', 1_500_000)).toBe(1);
    expect(store.countUserPartner(hash, 'polymarket', 2_500_000)).toBe(0);
    store.close();
  });
});
