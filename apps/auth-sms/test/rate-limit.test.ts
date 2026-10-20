import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Storage } from '../src/storage.js';
import { checkOtpRequestLimit } from '../src/rate-limit.js';

// The defaults were loosened on 2026-05-22 (20 s cooldown, 30 per phone,
// 60 per IP); these two cases test the mechanics with the caps they name.
const STRICT = { phoneCooldownSeconds: 60, phoneHourlyMax: 5, ipHourlyMax: 30 };

let storage: Storage;

beforeEach(() => {
  storage = new Storage({ path: ':memory:' });
});

afterEach(() => {
  storage.close();
});

describe('rate-limit', () => {
  const phone = '+6421999000';
  const ip = '203.0.113.5';

  it('allows the first OTP request', () => {
    const r = checkOtpRequestLimit({
      storage,
      phone,
      ip,
      now: 1_700_000_000,
    });
    expect(r.ok).toBe(true);
  });

  it('blocks a second request inside the 60s cooldown', () => {
    const t = 1_700_000_000;
    const a = checkOtpRequestLimit({ storage, phone, ip, now: t });
    expect(a.ok).toBe(true);
    const b = checkOtpRequestLimit({ storage, phone, ip, now: t + 5 });
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.reason).toBe('phone-cooldown');
      expect(b.retryAfterSeconds).toBeGreaterThan(0);
      expect(b.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it('allows a request after the cooldown expires', () => {
    const t = 1_700_000_000;
    expect(checkOtpRequestLimit({ storage, phone, ip, now: t }).ok).toBe(true);
    expect(
      checkOtpRequestLimit({ storage, phone, ip, now: t + 65 }).ok,
    ).toBe(true);
  });

  it('blocks at 5 requests per phone per hour', () => {
    let t = 1_700_000_000;
    // 5 requests across the hour, each just outside the 60s cooldown.
    for (let i = 0; i < 5; i++) {
      const r = checkOtpRequestLimit({ storage, phone, ip, now: t, config: STRICT });
      expect(r.ok).toBe(true);
      t += 65;
    }
    const blocked = checkOtpRequestLimit({ storage, phone, ip, now: t, config: STRICT });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe('phone-hourly');
  });

  it('blocks at 30 requests per IP per hour', () => {
    let t = 1_700_000_000;
    for (let i = 0; i < 30; i++) {
      const phoneI = `+642100000${String(i).padStart(2, '0')}`;
      const r = checkOtpRequestLimit({ storage, phone: phoneI, ip, now: t, config: STRICT });
      expect(r.ok).toBe(true);
      t += 1;
    }
    const blocked = checkOtpRequestLimit({
      storage,
      phone: '+6421999999',
      ip,
      now: t + 100,
      config: STRICT,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe('ip-hourly');
  });

  it('different phones share the IP bucket but not the phone bucket', () => {
    const t = 1_700_000_000;
    const a = checkOtpRequestLimit({
      storage,
      phone: '+6421000001',
      ip,
      now: t,
    });
    const b = checkOtpRequestLimit({
      storage,
      phone: '+6421000002',
      ip,
      now: t + 1,
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});
