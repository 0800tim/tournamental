import { createHash } from "node:crypto";

/**
 * Deterministic sha256 sorted-pair merkle tree.
 *
 * Shape matches the central server's commitment format so any third party
 * holding a single leaf + path can verify against the on-chain anchor.
 *
 * Rules:
 *   - Leaves are hashed once before pairing.
 *   - Pairs are sorted lex-ascending by their hex hash before concatenation.
 *     This means a verifier needs only the sibling hash, not its position.
 *   - Odd nodes promote (carry up) without rehashing, matching Bitcoin-style
 *     merkle trees minus the duplicate-last-leaf misfeature.
 *   - Empty input returns the empty-tree marker (sha256 of zero bytes).
 */

const EMPTY_TREE_ROOT = sha256(Buffer.alloc(0));

export function sha256(buf: Buffer | string): string {
  const input = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return createHash("sha256").update(input).digest("hex");
}

export function hashLeaf(value: string): string {
  return sha256(value);
}

export function hashPair(a: string, b: string): string {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return sha256(Buffer.from(lo + hi, "utf8"));
}

export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return EMPTY_TREE_ROOT;
  let layer = leaves.map(hashLeaf);
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]!;
      const right = layer[i + 1];
      next.push(right === undefined ? left : hashPair(left, right));
    }
    layer = next;
  }
  return layer[0]!;
}

export interface MerkleProofStep {
  sibling: string;
}

export interface MerkleProof {
  leaf: string;
  leaf_hash: string;
  path: MerkleProofStep[];
  root: string;
}

/**
 * Build a merkle proof for a specific leaf index.
 *
 * Returns `null` if the index is out of range.
 */
export function merkleProof(leaves: string[], index: number): MerkleProof | null {
  if (index < 0 || index >= leaves.length) return null;
  if (leaves.length === 0) return null;

  const leaf = leaves[index]!;
  const leafHash = hashLeaf(leaf);
  let layer = leaves.map(hashLeaf);
  let cursor = index;
  const path: MerkleProofStep[] = [];

  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]!;
      const right = layer[i + 1];
      next.push(right === undefined ? left : hashPair(left, right));
    }

    const siblingIndex = cursor % 2 === 0 ? cursor + 1 : cursor - 1;
    if (siblingIndex < layer.length) {
      path.push({ sibling: layer[siblingIndex]! });
    }
    cursor = Math.floor(cursor / 2);
    layer = next;
  }

  return {
    leaf,
    leaf_hash: leafHash,
    path,
    root: layer[0]!,
  };
}

export function verifyProof(proof: MerkleProof): boolean {
  let cursor = proof.leaf_hash;
  if (cursor !== hashLeaf(proof.leaf)) return false;
  for (const step of proof.path) {
    cursor = hashPair(cursor, step.sibling);
  }
  return cursor === proof.root;
}
