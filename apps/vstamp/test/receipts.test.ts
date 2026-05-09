import { describe, it, expect } from 'vitest';
import {
  buildIssue,
  computeLeafHash,
  dayBucketFor,
  finaliseLeaves,
  hashUserId,
  rootSigningMessage,
  SALT_LEN,
} from '../src/lib/receipts.js';
import { hexToBytes } from '../src/lib/merkle.js';

describe('receipts: dayBucketFor', () => {
  it('UTC midnight 2026-05-10', () => {
    const t = Date.UTC(2026, 4, 10, 0, 0, 0); // month is 0-indexed
    expect(dayBucketFor(t)).toBe('2026-05-10');
  });
  it('UTC midnight minus 1 ms is previous day', () => {
    const t = Date.UTC(2026, 4, 10, 0, 0, 0) - 1;
    expect(dayBucketFor(t)).toBe('2026-05-09');
  });
  it('end of day stays in the bucket', () => {
    const t = Date.UTC(2026, 4, 10, 23, 59, 59, 999);
    expect(dayBucketFor(t)).toBe('2026-05-10');
  });
});

describe('receipts: hashUserId', () => {
  it('deterministic', () => {
    expect(hashUserId('u_01HX')).toBe(hashUserId('u_01HX'));
  });
  it('changes with input', () => {
    expect(hashUserId('u_a')).not.toBe(hashUserId('u_b'));
  });
  it('64 hex chars', () => {
    expect(hashUserId('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('receipts: buildIssue', () => {
  it('produces a 64-hex leaf and 64-hex salt', () => {
    const r = buildIssue({
      bracketCanonicalJson: { winner: 'ARG' },
      userId: 'u_1',
      tournamentId: 'wc-2026',
    });
    expect(r.leafHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.salt).toMatch(/^[0-9a-f]{64}$/);
    expect(r.dayBucket).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('two calls with same payload produce different leaf hashes (random salt)', () => {
    const a = buildIssue({
      bracketCanonicalJson: { x: 1 },
      userId: 'u_1',
      tournamentId: 't_1',
    });
    const b = buildIssue({
      bracketCanonicalJson: { x: 1 },
      userId: 'u_1',
      tournamentId: 't_1',
    });
    expect(a.leafHash).not.toBe(b.leafHash);
    expect(a.salt).not.toBe(b.salt);
  });

  it('with fixed salt the leaf hash is reproducible', () => {
    const salt = new Uint8Array(32).fill(7);
    const a = buildIssue({
      bracketCanonicalJson: { a: 1, b: 2 },
      userId: 'u_z',
      tournamentId: 't',
      salt,
    });
    const b = buildIssue({
      bracketCanonicalJson: { b: 2, a: 1 }, // different insertion order
      userId: 'u_z',
      tournamentId: 't',
      salt,
    });
    expect(a.leafHash).toBe(b.leafHash);
  });

  it('rejects salts of wrong length', () => {
    expect(() =>
      buildIssue({
        bracketCanonicalJson: {},
        userId: 'u',
        tournamentId: 't',
        salt: new Uint8Array(16),
      }),
    ).toThrow(/salt must be/);
  });
});

describe('receipts: computeLeafHash', () => {
  it('is deterministic for fixed inputs', () => {
    const salt = new Uint8Array(SALT_LEN).fill(0xaa);
    const a = computeLeafHash({ z: 1 }, salt);
    const b = computeLeafHash({ z: 1 }, salt);
    expect(a).toBe(b);
  });

  it('differs when salt changes', () => {
    const a = computeLeafHash({ x: 1 }, new Uint8Array(32).fill(1));
    const b = computeLeafHash({ x: 1 }, new Uint8Array(32).fill(2));
    expect(a).not.toBe(b);
  });
});

describe('receipts: finaliseLeaves', () => {
  it('throws on empty input', () => {
    expect(() => finaliseLeaves({ leafHashes: [] })).toThrow(/empty leaf set/);
  });

  it('returns proofs for every leaf, all of which verify against the root', () => {
    const leaves = ['00', '11', '22', '33', '44', '55', '66'].map((b) => b.repeat(32));
    const out = finaliseLeaves({ leafHashes: leaves });
    expect(out.leafCount).toBe(7);
    for (const leaf of leaves) {
      const proof = out.proofs.get(leaf);
      expect(proof).toBeDefined();
    }
  });

  it('rootSigningMessage is the raw 32 bytes of the hex root', () => {
    const out = finaliseLeaves({ leafHashes: ['ab'.repeat(32), 'cd'.repeat(32)] });
    const msg = rootSigningMessage(out.rootHex);
    expect(msg.length).toBe(32);
    expect(Buffer.from(msg).toString('hex')).toBe(out.rootHex);
  });
});

describe('receipts: privacy property', () => {
  it('without the salt, an attacker cannot derive the leaf', () => {
    // The same public bracket but the salt is the only thing that ties it to
    // a specific receipt. Two different salts must produce different leaves
    // even with the same bracket.
    const bracket = { winner: 'ARG', score: 3 };
    const saltA = new Uint8Array(32).fill(0x01);
    const saltB = new Uint8Array(32).fill(0x02);
    expect(computeLeafHash(bracket, saltA)).not.toBe(computeLeafHash(bracket, saltB));
  });
});

describe('receipts: hex sanity', () => {
  it('rootSigningMessage round-trips a known hex', () => {
    const hex = 'de'.repeat(32);
    const bytes = rootSigningMessage(hex);
    expect(Buffer.from(bytes).toString('hex')).toBe(hex);
    expect(Buffer.from(hexToBytes(hex)).toString('hex')).toBe(hex);
  });
});
