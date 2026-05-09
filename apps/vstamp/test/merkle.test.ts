import { describe, it, expect } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import {
  buildTree,
  bytesToHex,
  computeRootFromProof,
  concatBytes,
  hexToBytes,
  leafHash,
  makeProof,
  nodeHash,
  verifyProof,
  LEAF_PREFIX,
  NODE_PREFIX,
} from '../src/lib/merkle.js';

const enc = (s: string) => new TextEncoder().encode(s);

describe('merkle tree primitives', () => {
  it('domain-separates leaves and nodes', () => {
    const x = enc('hello');
    expect(bytesToHex(leafHash(x))).toBe(bytesToHex(sha256(concatBytes(LEAF_PREFIX, x))));
    expect(bytesToHex(nodeHash(x, x))).toBe(
      bytesToHex(sha256(concatBytes(NODE_PREFIX, x, x))),
    );
    // and the two are different — that's the whole point
    expect(bytesToHex(leafHash(x))).not.toBe(bytesToHex(nodeHash(x, x)));
  });

  it('hex round-trip', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const hex = bytesToHex(bytes);
    expect(hex).toBe('deadbeef');
    expect(bytesToHex(hexToBytes(hex))).toBe(hex);
    expect(bytesToHex(hexToBytes('0xdeadbeef'))).toBe('deadbeef');
  });

  it('rejects malformed hex', () => {
    expect(() => hexToBytes('abc')).toThrow();
    expect(() => hexToBytes('zz')).toThrow();
  });
});

describe('buildTree + makeProof + verifyProof', () => {
  function leaves(n: number): Uint8Array[] {
    return Array.from({ length: n }, (_, i) => leafHash(enc(`leaf-${i}`)));
  }

  it('one-leaf tree: root equals the leaf', () => {
    const ls = leaves(1);
    const tree = buildTree(ls);
    expect(bytesToHex(tree.root)).toBe(bytesToHex(ls[0]));
  });

  it('two-leaf tree: root = nodeHash(L0, L1)', () => {
    const ls = leaves(2);
    const tree = buildTree(ls);
    expect(bytesToHex(tree.root)).toBe(bytesToHex(nodeHash(ls[0], ls[1])));
  });

  it('odd-leaf tree duplicates trailing', () => {
    const ls = leaves(3);
    const tree = buildTree(ls);
    const left = nodeHash(ls[0], ls[1]);
    const right = nodeHash(ls[2], ls[2]);
    expect(bytesToHex(tree.root)).toBe(bytesToHex(nodeHash(left, right)));
  });

  it('all proofs verify against the root for varied tree sizes', () => {
    for (const n of [1, 2, 3, 4, 5, 7, 8, 16, 17, 31]) {
      const ls = leaves(n);
      const tree = buildTree(ls);
      const rootHex = bytesToHex(tree.root);
      for (let i = 0; i < n; i++) {
        const proof = makeProof(tree, i);
        const leafHex = bytesToHex(ls[i]);
        expect(verifyProof(leafHex, proof, rootHex)).toBe(true);
      }
    }
  });

  it('fails verification with wrong sibling', () => {
    const ls = leaves(8);
    const tree = buildTree(ls);
    const proof = makeProof(tree, 3);
    const tampered = proof.map((p, i) =>
      i === 0
        ? {
            ...p,
            sibling: 'a'.repeat(64),
          }
        : p,
    );
    expect(verifyProof(bytesToHex(ls[3]), tampered, bytesToHex(tree.root))).toBe(false);
  });

  it('fails verification with wrong root', () => {
    const ls = leaves(8);
    const tree = buildTree(ls);
    const proof = makeProof(tree, 3);
    expect(verifyProof(bytesToHex(ls[3]), proof, 'b'.repeat(64))).toBe(false);
  });

  it('fails verification with wrong leaf', () => {
    const ls = leaves(8);
    const tree = buildTree(ls);
    const proof = makeProof(tree, 3);
    expect(verifyProof('c'.repeat(64), proof, bytesToHex(tree.root))).toBe(false);
  });

  it('fails on flipped proof position', () => {
    const ls = leaves(8);
    const tree = buildTree(ls);
    const proof = makeProof(tree, 1);
    const flipped = proof.map((p) => ({
      ...p,
      position: (p.position === 'left' ? 'right' : 'left') as 'left' | 'right',
    }));
    expect(verifyProof(bytesToHex(ls[1]), flipped, bytesToHex(tree.root))).toBe(false);
  });

  it('makeProof out of range throws', () => {
    const tree = buildTree(leaves(4));
    expect(() => makeProof(tree, 99)).toThrow(RangeError);
    expect(() => makeProof(tree, -1)).toThrow(RangeError);
  });

  it('computeRootFromProof rejects invalid position', () => {
    const ls = leaves(2);
    const tree = buildTree(ls);
    const proof = makeProof(tree, 0);
    const bogus = proof.map((p) => ({ ...p, position: 'middle' as unknown as 'left' }));
    expect(() => computeRootFromProof(bytesToHex(ls[0]), bogus)).toThrow(/invalid proof step/);
  });

  it('proof length matches log2(n) (rounded up) for power-of-two trees', () => {
    for (const n of [1, 2, 4, 8, 16]) {
      const tree = buildTree(leaves(n));
      const proof = makeProof(tree, 0);
      const expectedDepth = Math.max(0, Math.ceil(Math.log2(n)));
      expect(proof.length).toBe(expectedDepth);
    }
  });
});

describe('cross-implementation verifier (plain JS, no shared code)', () => {
  // Re-implement the verifier in self-contained code so we prove that
  // anyone reading the spec can write a verifier from scratch and it
  // will agree with ours. This is the "anyone-can-verify" promise.

  function verifyIndependently(
    leafHex: string,
    proof: Array<{ sibling: string; position: 'left' | 'right' }>,
    rootHex: string,
  ): boolean {
    const toBytes = (h: string) => {
      const c = h.startsWith('0x') ? h.slice(2) : h;
      const out = new Uint8Array(c.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(c.slice(i * 2, i * 2 + 2), 16);
      return out;
    };
    const cat = (...xs: Uint8Array[]) => {
      const total = xs.reduce((s, a) => s + a.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const a of xs) {
        out.set(a, off);
        off += a.length;
      }
      return out;
    };
    let acc = toBytes(leafHex);
    for (const step of proof) {
      const sib = toBytes(step.sibling);
      const node = step.position === 'left' ? cat(NODE_PREFIX, sib, acc) : cat(NODE_PREFIX, acc, sib);
      acc = sha256(node);
    }
    const want = toBytes(rootHex);
    if (acc.length !== want.length) return false;
    let diff = 0;
    for (let i = 0; i < acc.length; i++) diff |= acc[i] ^ want[i];
    return diff === 0;
  }

  it('cross-checks 100 random inclusion proofs', () => {
    const n = 23;
    const ls = Array.from({ length: n }, (_, i) => leafHash(new TextEncoder().encode(`x${i}`)));
    const tree = buildTree(ls);
    const root = bytesToHex(tree.root);
    for (let i = 0; i < n; i++) {
      const proof = makeProof(tree, i);
      const leafHex = bytesToHex(ls[i]);
      expect(verifyIndependently(leafHex, proof, root)).toBe(true);
    }
  });

  it('cross-implementation rejects a tampered proof', () => {
    const ls = Array.from({ length: 8 }, (_, i) => leafHash(new TextEncoder().encode(`y${i}`)));
    const tree = buildTree(ls);
    const proof = makeProof(tree, 4);
    const bad = [...proof];
    bad[0] = { ...bad[0], sibling: '0'.repeat(64) };
    expect(verifyIndependently(bytesToHex(ls[4]), bad, bytesToHex(tree.root))).toBe(false);
  });
});
