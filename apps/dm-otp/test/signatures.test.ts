import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  verifyTelegramSecret,
  verifyHmacSha256Header,
  hmacSha256Hex,
} from '../src/lib/signatures.js';

describe('verifyTelegramSecret', () => {
  it('matches identical strings', () => {
    expect(
      verifyTelegramSecret({ header: 'abc123', expected: 'abc123' }),
    ).toBe(true);
  });
  it('rejects mismatched strings', () => {
    expect(
      verifyTelegramSecret({ header: 'abc123', expected: 'abc1234' }),
    ).toBe(false);
  });
  it('rejects missing header', () => {
    expect(
      verifyTelegramSecret({ header: undefined, expected: 'abc' }),
    ).toBe(false);
  });
  it('rejects empty expected', () => {
    expect(verifyTelegramSecret({ header: 'abc', expected: '' })).toBe(false);
  });
});

describe('verifyHmacSha256Header', () => {
  const secret = 'super-secret';
  const body = JSON.stringify({ hello: 'world' });
  const validHex = createHmac('sha256', secret).update(body).digest('hex');

  it('verifies a valid sha256 header', () => {
    expect(
      verifyHmacSha256Header({
        header: `sha256=${validHex}`,
        rawBody: body,
        secret,
      }),
    ).toBe(true);
  });
  it('rejects a mutated body', () => {
    expect(
      verifyHmacSha256Header({
        header: `sha256=${validHex}`,
        rawBody: body + 'x',
        secret,
      }),
    ).toBe(false);
  });
  it('rejects a wrong scheme', () => {
    expect(
      verifyHmacSha256Header({
        header: `sha1=${validHex}`,
        rawBody: body,
        secret,
      }),
    ).toBe(false);
  });
  it('rejects a malformed header', () => {
    expect(
      verifyHmacSha256Header({
        header: 'no-equals-here',
        rawBody: body,
        secret,
      }),
    ).toBe(false);
  });
  it('rejects with non-hex provided', () => {
    expect(
      verifyHmacSha256Header({
        header: 'sha256=zzzzzz',
        rawBody: body,
        secret,
      }),
    ).toBe(false);
  });
  it('hmacSha256Hex is stable', () => {
    expect(hmacSha256Hex(secret, body)).toBe(validHex);
  });
});
