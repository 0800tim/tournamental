import { describe, it, expect } from 'vitest';
import { createHmac, generateKeyPairSync, sign as edSign } from 'node:crypto';
import {
  verifyMetaSignature,
  verifySlackSignature,
  verifyLineSignature,
  verifyViberSignature,
  verifyXSignature,
  verifyMailgunSignature,
  verifyDiscordSignature,
  verifyBearer,
  verifyTelegramSecret,
  verifyHmacSha256Header,
  hmacSha256Hex,
} from '../src/lib/signatures.js';

describe('verifyMetaSignature', () => {
  it('accepts a valid sha256 signature', () => {
    const secret = 'meta-secret';
    const body = '{"foo":"bar"}';
    const expected = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyMetaSignature(secret, body, `sha256=${expected}`)).toBe(true);
  });
  it('rejects a tampered body', () => {
    const secret = 'meta-secret';
    const expected = createHmac('sha256', secret).update('{"foo":"bar"}').digest('hex');
    expect(verifyMetaSignature(secret, '{"foo":"baz"}', `sha256=${expected}`)).toBe(false);
  });
  it('rejects a missing header', () => {
    expect(verifyMetaSignature('s', 'body', undefined)).toBe(false);
  });
});

describe('verifySlackSignature', () => {
  it('accepts within window', () => {
    const secret = 'slack-secret';
    const ts = '1700000000';
    const body = 'token=...';
    const expected = `v0=${createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')}`;
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp: ts,
        signature: expected,
        rawBody: body,
        now: 1700000010,
      }),
    ).toBe(true);
  });
  it('rejects stale timestamp', () => {
    const secret = 'slack-secret';
    const ts = '1700000000';
    const body = 'token=...';
    const expected = `v0=${createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')}`;
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp: ts,
        signature: expected,
        rawBody: body,
        now: 1700000000 + 600,
      }),
    ).toBe(false);
  });
});

describe('verifyLineSignature', () => {
  it('accepts a valid base64 HMAC', () => {
    const secret = 'line-secret';
    const body = '{}';
    const sig = createHmac('sha256', secret).update(body).digest('base64');
    expect(verifyLineSignature(secret, body, sig)).toBe(true);
    expect(verifyLineSignature(secret, body, 'wrong')).toBe(false);
  });
});

describe('verifyViberSignature', () => {
  it('accepts a valid hex HMAC', () => {
    const token = 'viber-token';
    const body = '{}';
    const sig = createHmac('sha256', token).update(body).digest('hex');
    expect(verifyViberSignature(token, body, sig)).toBe(true);
    expect(verifyViberSignature(token, body, 'no')).toBe(false);
  });
});

describe('verifyXSignature', () => {
  it('accepts a valid base64 HMAC', () => {
    const secret = 'x-consumer-secret';
    const body = '{}';
    const sig = createHmac('sha256', secret).update(body).digest('base64');
    expect(verifyXSignature(secret, body, `sha256=${sig}`)).toBe(true);
  });
});

describe('verifyMailgunSignature', () => {
  it('accepts a valid signature within window', () => {
    const key = 'mailgun-key';
    const ts = '1700000000';
    const token = 'tok';
    const sig = createHmac('sha256', key).update(`${ts}${token}`).digest('hex');
    expect(
      verifyMailgunSignature({
        signingKey: key,
        timestamp: ts,
        token,
        signature: sig,
        now: Number(ts) + 60,
      }),
    ).toBe(true);
  });
});

describe('verifyDiscordSignature', () => {
  it('accepts a valid Ed25519 signature', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pubRaw = publicKey.export({ format: 'der', type: 'spki' }).slice(-32);
    const ts = '1700000000';
    const body = '{"type":1}';
    const sig = edSign(null, Buffer.from(ts + body, 'utf8'), privateKey);
    expect(
      verifyDiscordSignature({
        publicKeyHex: pubRaw.toString('hex'),
        signatureHex: sig.toString('hex'),
        timestamp: ts,
        rawBody: body,
      }),
    ).toBe(true);
  });
  it('rejects a tampered body', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pubRaw = publicKey.export({ format: 'der', type: 'spki' }).slice(-32);
    const ts = '1700000000';
    const sig = edSign(null, Buffer.from(ts + '{}', 'utf8'), privateKey);
    expect(
      verifyDiscordSignature({
        publicKeyHex: pubRaw.toString('hex'),
        signatureHex: sig.toString('hex'),
        timestamp: ts,
        rawBody: '{"x":1}',
      }),
    ).toBe(false);
  });
});

describe('verifyBearer', () => {
  it('accepts the right token', () => {
    expect(verifyBearer('s3cret', 'Bearer s3cret')).toBe(true);
    expect(verifyBearer('s3cret', 'Bearer wrong')).toBe(false);
    expect(verifyBearer('s3cret', undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Legacy helper tests carried over from PR #90.
// ---------------------------------------------------------------------------

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
