import { describe, it, expect } from 'vitest';
import { normaliseCountry, resolveCountry } from '../src/geo';

describe('normaliseCountry', () => {
  it('uppercases and returns valid ISO2', () => {
    expect(normaliseCountry('nz')).toBe('NZ');
    expect(normaliseCountry('NZ')).toBe('NZ');
    expect(normaliseCountry('  us  ')).toBe('US');
  });

  it('rejects empty / null / undefined', () => {
    expect(normaliseCountry(null)).toBeNull();
    expect(normaliseCountry(undefined)).toBeNull();
    expect(normaliseCountry('')).toBeNull();
  });

  it('rejects non-2-letter strings', () => {
    expect(normaliseCountry('USA')).toBeNull();
    expect(normaliseCountry('U')).toBeNull();
    expect(normaliseCountry('12')).toBeNull();
  });

  it('rejects CF placeholder country codes', () => {
    expect(normaliseCountry('XX')).toBeNull();
    expect(normaliseCountry('T1')).toBeNull();
    expect(normaliseCountry('xx')).toBeNull();
  });
});

describe('resolveCountry', () => {
  it('returns cf-ipcountry when present', () => {
    const got = resolveCountry({
      headers: { 'cf-ipcountry': 'GB' },
      query: {},
    });
    expect(got).toBe('GB');
  });

  it('falls back to ?country query', () => {
    const got = resolveCountry({
      headers: {},
      query: { country: 'AU' },
    });
    expect(got).toBe('AU');
  });

  it('cf-ipcountry beats ?country', () => {
    const got = resolveCountry({
      headers: { 'cf-ipcountry': 'NZ' },
      query: { country: 'US' },
    });
    expect(got).toBe('NZ');
  });

  it('skips invalid cf-ipcountry and falls through to query', () => {
    const got = resolveCountry({
      headers: { 'cf-ipcountry': 'XX' },
      query: { country: 'JP' },
    });
    expect(got).toBe('JP');
  });

  it('returns null when neither resolves', () => {
    const got = resolveCountry({
      headers: {},
      query: {},
    });
    expect(got).toBeNull();
  });

  it('handles array-valued headers (Fastify edge case)', () => {
    const got = resolveCountry({
      headers: { 'cf-ipcountry': ['DE', 'FR'] },
      query: {},
    });
    expect(got).toBe('DE');
  });
});
