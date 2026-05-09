/**
 * Domain-separated Merkle tree (RFC 6962-style construction).
 *
 * Construction:
 *   leafHash(x)        = sha256(0x00 || x)
 *   nodeHash(L, R)     = sha256(0x01 || L || R)
 *
 * Domain separation prevents second-preimage attacks: an attacker can't
 * submit a fabricated leaf whose bytes happen to equal an existing node's
 * concatenation, because leaves and nodes hash under different prefixes.
 *
 * Odd-leaf handling: when a level has an odd number of nodes, the last node
 * is duplicated to pair with itself (Bitcoin-style). Verifiers must follow
 * the same rule. We document this explicitly because Bitcoin's
 * duplicate-trailing-leaf is famously a footgun if mis-specified — but for
 * our use the leaves are unique 32-byte digests so the duplicate-leaf attack
 * (CVE-2012-2459) does not apply: a valid receipt always carries its
 * inclusion proof and the verifier reconstructs upward from the leaf with the
 * exact sibling sequence, so a "fake" duplicated-leaf cannot be passed off as
 * a real one (it never has a corresponding receipt).
 *
 * Inclusion proof shape:
 *   [{ sibling: hex32, position: 'left' | 'right' }, ...]  (low level → root)
 *
 * `position` is the side the *sibling* sits on. To recompute, at each step
 *   if position === 'left':  acc = nodeHash(sibling, acc)
 *   if position === 'right': acc = nodeHash(acc, sibling)
 */

import { sha256 } from '@noble/hashes/sha256';

export const LEAF_PREFIX = new Uint8Array([0x00]);
export const NODE_PREFIX = new Uint8Array([0x01]);

export interface ProofStep {
  sibling: string; // hex
  position: 'left' | 'right';
}

export interface MerkleTree {
  root: Uint8Array;
  leaves: Uint8Array[];
  levels: Uint8Array[][]; // levels[0] = leaves, levels[N] = [root]
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error(`hex string has odd length: ${clean.length}`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`invalid hex at offset ${i * 2}`);
    }
    out[i] = byte;
  }
  return out;
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

export function leafHash(payload: Uint8Array): Uint8Array {
  return sha256(concatBytes(LEAF_PREFIX, payload));
}

export function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concatBytes(NODE_PREFIX, left, right));
}

/**
 * Build a Merkle tree from already-hashed leaves (32-byte digests).
 *
 * Empty inputs return a tree whose root is sha256(0x01) by convention — but
 * the caller should reject empty trees at the API layer. We don't throw here
 * to keep this primitive pure.
 */
export function buildTree(leaves: Uint8Array[]): MerkleTree {
  if (leaves.length === 0) {
    const empty = nodeHash(new Uint8Array(0), new Uint8Array(0));
    return { root: empty, leaves: [], levels: [[], [empty]] };
  }

  const levels: Uint8Array[][] = [leaves.slice()];
  let cur = leaves.slice();

  while (cur.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < cur.length; i += 2) {
      const left = cur[i];
      const right = i + 1 < cur.length ? cur[i + 1] : cur[i]; // duplicate trailing
      next.push(nodeHash(left, right));
    }
    levels.push(next);
    cur = next;
  }

  return { root: cur[0], leaves, levels };
}

/**
 * Inclusion proof for the leaf at `leafIndex`.
 *
 * Returns the sequence of siblings from the leaf level up to (but not
 * including) the root.
 */
export function makeProof(tree: MerkleTree, leafIndex: number): ProofStep[] {
  if (leafIndex < 0 || leafIndex >= tree.leaves.length) {
    throw new RangeError(`leafIndex out of range: ${leafIndex}`);
  }
  const proof: ProofStep[] = [];
  let idx = leafIndex;

  for (let l = 0; l < tree.levels.length - 1; l++) {
    const level = tree.levels[l];
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    const sibling = siblingIdx < level.length ? level[siblingIdx] : level[idx]; // duplicate
    proof.push({
      sibling: bytesToHex(sibling),
      position: isRight ? 'left' : 'right',
    });
    idx = Math.floor(idx / 2);
  }

  return proof;
}

/**
 * Recompute the root from a leaf hash and its inclusion proof.
 *
 * Pure function — the heart of the verifier. Anyone with a hex leaf hash and
 * the proof JSON can call this and compare against the claimed signed root.
 */
export function computeRootFromProof(leafHex: string, proof: ProofStep[]): Uint8Array {
  let acc = hexToBytes(leafHex);
  for (const step of proof) {
    const sib = hexToBytes(step.sibling);
    if (step.position === 'left') {
      acc = nodeHash(sib, acc);
    } else if (step.position === 'right') {
      acc = nodeHash(acc, sib);
    } else {
      throw new Error(`invalid proof step position: ${(step as ProofStep).position}`);
    }
  }
  return acc;
}

export function verifyProof(
  leafHex: string,
  proof: ProofStep[],
  expectedRootHex: string,
): boolean {
  let computed: Uint8Array;
  try {
    computed = computeRootFromProof(leafHex, proof);
  } catch {
    return false;
  }
  const expected = hexToBytes(expectedRootHex);
  return constantTimeEqual(computed, expected);
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
