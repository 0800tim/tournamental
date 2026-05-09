import { describe, it, expect } from 'vitest';
import { normalisePhone, maskPhone } from '../src/phone.js';

describe('normalisePhone', () => {
  it('accepts E.164 with leading +', () => {
    expect(normalisePhone('+6421999000')).toBe('+6421999000');
  });
  it('strips spaces, dashes, and parentheses', () => {
    expect(normalisePhone('+64 (21) 999-000')).toBe('+6421999000');
  });
  it('rejects no leading +', () => {
    expect(normalisePhone('6421999000')).toBeNull();
    expect(normalisePhone('021999000')).toBeNull();
  });
  it('rejects too short / too long', () => {
    expect(normalisePhone('+6421')).toBeNull();
    expect(normalisePhone('+1' + '2'.repeat(20))).toBeNull();
  });
  it('rejects junk', () => {
    expect(normalisePhone('+abcdef')).toBeNull();
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone(null)).toBeNull();
    expect(normalisePhone(undefined)).toBeNull();
  });
});

describe('maskPhone', () => {
  it('masks middle digits leaving country code and last 3', () => {
    expect(maskPhone('+6421999000')).toBe('+64*****000');
  });
});
