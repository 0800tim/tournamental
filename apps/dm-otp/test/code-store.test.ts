import { describe, it, expect } from 'vitest';
import { CodeStore } from '../src/code-store.js';

describe('CodeStore', () => {
  it('put/claim happy path', () => {
    const s = new CodeStore({ ttlMs: 1000 });
    expect(s.put('123456', { channel: 'telegram', externalId: '42' })).toBe(true);
    const r = s.claim('123456');
    expect(r?.channel).toBe('telegram');
    expect(r?.externalId).toBe('42');
  });

  it('claim is single-use', () => {
    const s = new CodeStore({ ttlMs: 1000 });
    s.put('111111', { channel: 'whatsapp', externalId: '+6421000' });
    expect(s.claim('111111')).not.toBeNull();
    expect(s.claim('111111')).toBeNull();
  });

  it('claim returns null after expiry', () => {
    let now = 1_000_000;
    const s = new CodeStore({ ttlMs: 100, now: () => now });
    s.put('222222', { channel: 'messenger', externalId: 'psid' });
    now += 200;
    expect(s.claim('222222')).toBeNull();
  });

  it('put returns false on collision', () => {
    const s = new CodeStore();
    expect(s.put('333333', { channel: 'telegram', externalId: '1' })).toBe(true);
    expect(s.put('333333', { channel: 'telegram', externalId: '2' })).toBe(false);
  });

  it('claim returns null for unknown code', () => {
    const s = new CodeStore();
    expect(s.claim('999999')).toBeNull();
  });
});
