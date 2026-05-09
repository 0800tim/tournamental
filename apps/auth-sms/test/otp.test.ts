import { describe, it, expect } from 'vitest';
import {
  generateOtp,
  hashOtp,
  safeEqualHex,
  formatSmsBody,
  formatWhatsAppBody,
  OTP_LENGTH,
} from '../src/otp.js';

describe('otp', () => {
  it('generateOtp produces a zero-padded 6-digit numeric string', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateOtp();
      expect(code).toHaveLength(OTP_LENGTH);
      expect(/^\d{6}$/.test(code)).toBe(true);
    }
  });

  it('generateOtp distribution covers leading-zero cases', () => {
    // 100 draws should produce >=1 with leading zero ~with high prob.
    // Loosen to 2k draws so the test isn't flaky.
    let leadingZero = 0;
    for (let i = 0; i < 2000; i++) {
      if (generateOtp().startsWith('0')) leadingZero++;
    }
    expect(leadingZero).toBeGreaterThan(0);
  });

  it('hashOtp is deterministic for same inputs', () => {
    const a = hashOtp({
      code: '123456',
      phone: '+6421999000',
      channel: 'sms',
      secret: 'super-secret-secret-32-chars-aaa',
    });
    const b = hashOtp({
      code: '123456',
      phone: '+6421999000',
      channel: 'sms',
      secret: 'super-secret-secret-32-chars-aaa',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashOtp differs for different phone, channel, or code', () => {
    const base = {
      code: '123456',
      phone: '+6421999000',
      channel: 'sms' as const,
      secret: 'super-secret-secret-32-chars-aaa',
    };
    const baseHash = hashOtp(base);
    expect(hashOtp({ ...base, code: '654321' })).not.toBe(baseHash);
    expect(hashOtp({ ...base, phone: '+6421999001' })).not.toBe(baseHash);
    expect(hashOtp({ ...base, channel: 'whatsapp' })).not.toBe(baseHash);
    expect(hashOtp({ ...base, secret: 'different-secret-32-chars-aaaaa' })).not.toBe(baseHash);
  });

  it('safeEqualHex matches identical hashes', () => {
    const a = hashOtp({
      code: '123456',
      phone: '+6421999000',
      channel: 'sms',
      secret: 'k',
    });
    expect(safeEqualHex(a, a)).toBe(true);
  });

  it('safeEqualHex rejects mismatched length, non-hex, and different content', () => {
    expect(safeEqualHex('aabbcc', 'aabbccdd')).toBe(false);
    expect(safeEqualHex('zzzzzz', 'zzzzzz')).toBe(false); // not hex
    expect(safeEqualHex('aabbcc', 'aabbcd')).toBe(false);
    // non-string
    // @ts-expect-error testing bad input
    expect(safeEqualHex(123, 'aabbcc')).toBe(false);
  });

  it('formatSmsBody includes WebOTP suffix on its own line', () => {
    const body = formatSmsBody({
      code: '123456',
      appHost: 'vtourn.com',
      productName: 'VTourn',
    });
    expect(body).toContain('Your VTourn code is 123456');
    expect(body).toMatch(/@vtourn\.com #123456$/);
  });

  it('formatWhatsAppBody emphasises the code and notes the expiry', () => {
    const body = formatWhatsAppBody({ code: '987654' });
    expect(body).toContain('*987654*');
    expect(body.toLowerCase()).toContain('expires');
  });
});
