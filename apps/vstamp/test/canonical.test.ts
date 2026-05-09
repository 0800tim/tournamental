import { describe, it, expect } from 'vitest';
import { canonicalize, canonicalBytes, CanonicalJSONError } from '../src/lib/canonical.js';

describe('canonical JSON', () => {
  it('sorts object keys lexicographically', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ z: 1, A: 2, a: 3 })).toBe('{"A":2,"a":3,"z":1}');
  });

  it('produces identical output regardless of insertion order', () => {
    const a = { team: 'ARG', score: 3, opponent: 'FRA' };
    const b = { opponent: 'FRA', team: 'ARG', score: 3 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('canonicalises nested objects', () => {
    const obj = { z: { b: 2, a: 1 }, a: [3, { y: 9, x: 8 }] };
    expect(canonicalize(obj)).toBe('{"a":[3,{"x":8,"y":9}],"z":{"a":1,"b":2}}');
  });

  it('strips whitespace', () => {
    expect(canonicalize({ a: 1, b: [2, 3] })).toBe('{"a":1,"b":[2,3]}');
  });

  it('rejects floats', () => {
    expect(() => canonicalize(0.5)).toThrow(CanonicalJSONError);
    expect(() => canonicalize({ p: 0.123 })).toThrow(/floats are not allowed/);
  });

  it('rejects NaN and Infinity', () => {
    expect(() => canonicalize(NaN)).toThrow(/non-finite/);
    expect(() => canonicalize(Infinity)).toThrow(/non-finite/);
    expect(() => canonicalize(-Infinity)).toThrow(/non-finite/);
  });

  it('handles null', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize({ a: null })).toBe('{"a":null}');
  });

  it('drops undefined keys (matching JSON.stringify)', () => {
    expect(canonicalize({ a: 1, b: undefined, c: 2 })).toBe('{"a":1,"c":2}');
  });

  it('encodes undefined inside arrays as null (matching JSON.stringify)', () => {
    expect(canonicalize([1, undefined, 3])).toBe('[1,null,3]');
  });

  it('throws on cycles', () => {
    const obj: { self?: unknown } = {};
    obj.self = obj;
    expect(() => canonicalize(obj)).toThrow(/cycle detected/);
  });

  it('handles string escapes via JSON.stringify', () => {
    expect(canonicalize('hello "world"')).toBe('"hello \\"world\\""');
    expect(canonicalize({ k: '\n' })).toBe('{"k":"\\n"}');
  });

  it('canonicalBytes returns UTF-8 of canonicalize', () => {
    const obj = { b: 1, a: 2 };
    const bytes = canonicalBytes(obj);
    expect(new TextDecoder().decode(bytes)).toBe('{"a":2,"b":1}');
  });

  it('handles unicode keys deterministically', () => {
    expect(canonicalize({ 'é': 1, 'a': 2 })).toBe('{"a":2,"é":1}');
  });

  it('serialises bigint as integer literal', () => {
    expect(canonicalize(BigInt(99))).toBe('99');
  });
});
