import { describe, it, expect } from 'vitest';
import {
  decryptPrivkey,
  encryptPrivkey,
  generateKeypair,
  safeCompare,
  sign,
  signHex,
  verifyHex,
  verifySignature,
} from '../src/lib/keys.js';
import { hexToBytes } from '../src/lib/merkle.js';

describe('keys: ed25519', () => {
  it('generated keypair is 32+32 bytes', () => {
    const { privkey, pubkey } = generateKeypair();
    expect(privkey.length).toBe(32);
    expect(pubkey.length).toBe(32);
  });

  it('signs and verifies', () => {
    const { privkey, pubkey } = generateKeypair();
    const msg = new TextEncoder().encode('vstamp test');
    const sig = sign(privkey, msg);
    expect(verifySignature(pubkey, msg, sig)).toBe(true);
  });

  it('rejects mutated message', () => {
    const { privkey, pubkey } = generateKeypair();
    const msg = new TextEncoder().encode('vstamp test');
    const sig = sign(privkey, msg);
    const bad = new TextEncoder().encode('vstamp tess'); // 1-byte diff
    expect(verifySignature(pubkey, bad, sig)).toBe(false);
  });

  it('signHex / verifyHex round-trip', () => {
    const { privkey, pubkey } = generateKeypair();
    const msg = new TextEncoder().encode('hello');
    const sigHex = signHex(privkey, msg);
    const pubHex = Buffer.from(pubkey).toString('hex');
    expect(verifyHex(pubHex, msg, sigHex)).toBe(true);
  });

  it('verifyHex with wrong pubkey returns false (no throw)', () => {
    expect(verifyHex('a'.repeat(64), new Uint8Array([1, 2, 3]), 'b'.repeat(128))).toBe(false);
  });
});

describe('keys: encrypt round-trip', () => {
  it('decrypt(encrypt(x, p), p) === x', () => {
    const { privkey } = generateKeypair();
    const enc = encryptPrivkey(privkey, 'correct horse battery staple');
    const dec = decryptPrivkey(enc, 'correct horse battery staple');
    expect(Buffer.from(dec).equals(Buffer.from(privkey))).toBe(true);
  });

  it('decrypt with wrong passphrase fails', () => {
    const { privkey } = generateKeypair();
    const enc = encryptPrivkey(privkey, 'correct horse battery staple');
    expect(() => decryptPrivkey(enc, 'wrong passphrase')).toThrow();
  });

  it('encrypted blob is non-deterministic (random salt + nonce)', () => {
    const { privkey } = generateKeypair();
    const a = encryptPrivkey(privkey, 'p');
    const b = encryptPrivkey(privkey, 'p');
    expect(a).not.toBe(b);
  });

  it('rejects tampered ciphertext (GCM auth)', () => {
    const { privkey } = generateKeypair();
    const enc = encryptPrivkey(privkey, 'p');
    const buf = Buffer.from(enc, 'base64');
    // flip a bit somewhere in the ciphertext region
    buf[40] ^= 0xff;
    expect(() => decryptPrivkey(buf.toString('base64'), 'p')).toThrow();
  });

  it('rejects wrong-length blob', () => {
    expect(() => decryptPrivkey(Buffer.from('abc').toString('base64'), 'p')).toThrow(/wrong length/);
  });

  it('rejects empty passphrase', () => {
    const { privkey } = generateKeypair();
    expect(() => encryptPrivkey(privkey, '')).toThrow(/PASSPHRASE/);
  });
});

describe('keys: safeCompare', () => {
  it('equal strings => true', () => {
    expect(safeCompare('abc', 'abc')).toBe(true);
  });
  it('different strings => false', () => {
    expect(safeCompare('abc', 'abd')).toBe(false);
  });
  it('different lengths => false', () => {
    expect(safeCompare('abc', 'abcd')).toBe(false);
  });
  it('empty inputs => false', () => {
    expect(safeCompare('', 'abc')).toBe(false);
    expect(safeCompare('abc', '')).toBe(false);
  });
});

describe('signature length', () => {
  it('ed25519 signatures are 64 bytes / 128 hex chars', () => {
    const { privkey } = generateKeypair();
    const sig = sign(privkey, new TextEncoder().encode('x'));
    expect(sig.length).toBe(64);
    expect(hexToBytes('00'.repeat(64)).length).toBe(64);
  });
});
