import { describe, expect, it } from "vitest";

import {
  hashLeaf,
  hashPair,
  merkleProof,
  merkleRoot,
  sha256,
  verifyProof,
} from "../src/merkle.js";

describe("merkle", () => {
  it("hashes a single leaf into its own root", () => {
    const root = merkleRoot(["alpha"]);
    expect(root).toEqual(hashLeaf("alpha"));
  });

  it("returns an empty-tree sentinel for zero leaves", () => {
    const root = merkleRoot([]);
    expect(root).toEqual(sha256(Buffer.alloc(0)));
  });

  it("is deterministic across runs", () => {
    const a = merkleRoot(["a", "b", "c", "d", "e"]);
    const b = merkleRoot(["a", "b", "c", "d", "e"]);
    expect(a).toEqual(b);
  });

  it("differs when a single leaf changes", () => {
    const a = merkleRoot(["a", "b", "c", "d"]);
    const b = merkleRoot(["a", "b", "c", "X"]);
    expect(a).not.toEqual(b);
  });

  it("hashes pairs commutatively (sorted-pair)", () => {
    expect(hashPair("aaa", "bbb")).toEqual(hashPair("bbb", "aaa"));
  });

  it("produces verifiable proofs for every leaf in a small tree", () => {
    const leaves = ["pick-1", "pick-2", "pick-3", "pick-4", "pick-5"];
    const root = merkleRoot(leaves);
    for (let i = 0; i < leaves.length; i++) {
      const proof = merkleProof(leaves, i);
      expect(proof).not.toBeNull();
      expect(proof!.root).toEqual(root);
      expect(verifyProof(proof!)).toBe(true);
    }
  });

  it("fails verification when the leaf is tampered with", () => {
    const leaves = ["pick-1", "pick-2", "pick-3", "pick-4"];
    const proof = merkleProof(leaves, 2);
    expect(proof).not.toBeNull();
    const bad = { ...proof!, leaf: "tampered" };
    expect(verifyProof(bad)).toBe(false);
  });

  it("returns null for an out-of-range index", () => {
    expect(merkleProof(["a", "b"], 5)).toBeNull();
    expect(merkleProof([], 0)).toBeNull();
  });

  it("handles a large odd-sized tree end-to-end", () => {
    const leaves = Array.from({ length: 1023 }, (_, i) => `bot-${i}`);
    const root = merkleRoot(leaves);
    const proof = merkleProof(leaves, 777);
    expect(proof).not.toBeNull();
    expect(proof!.root).toEqual(root);
    expect(verifyProof(proof!)).toBe(true);
  });
});
