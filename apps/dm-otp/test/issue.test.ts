import { describe, it, expect } from 'vitest';
import { isLoginTrigger, formatLoginMessage } from '../src/issue.js';
import { generateOtpCode, maskCode } from '../src/otp.js';

describe('isLoginTrigger', () => {
  it.each([
    ['log in', true],
    ['Log In', true],
    ['LOGIN', true],
    ['  log in  ', true],
    ['log  in', true],
    ['login', true],
    ['log me in', false],
    ['logging in', false],
    ['hello', false],
    ['', false],
  ])('%s -> %s', (input, expected) => {
    expect(isLoginTrigger(input)).toBe(expected);
  });
});

describe('generateOtpCode', () => {
  it('produces 6 digits', () => {
    for (let i = 0; i < 50; i++) {
      const c = generateOtpCode();
      expect(c).toMatch(/^\d{6}$/);
    }
  });
});

describe('maskCode', () => {
  it('keeps last digit only', () => {
    expect(maskCode('123456')).toBe('*****6');
    expect(maskCode('')).toBe('');
    expect(maskCode('1')).toBe('1');
  });
});

describe('formatLoginMessage', () => {
  it('mentions code, product, expiry', () => {
    const m = formatLoginMessage({
      code: '987654',
      productName: 'VTourn',
      ttlSeconds: 300,
    });
    expect(m).toContain('987654');
    expect(m).toContain('VTourn');
    expect(m).toContain('5 minutes');
  });
  it('no emojis or em-dashes', () => {
    const m = formatLoginMessage({
      code: '111111',
      productName: 'VTourn',
      ttlSeconds: 600,
    });
    expect(m).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(m).not.toContain('—');
  });
});
