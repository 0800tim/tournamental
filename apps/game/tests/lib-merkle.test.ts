/**
 * Sorted-pair sha256 merkle tree for the OTS kickoff commitment.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §15.6
 */
import { describe, it, expect } from "vitest";

import {
  buildMerkle,
  leafHash,
  verifyProof,
  type PickLeaf,
} from "../src/lib/merkle.js";

describe("merkle , leaf hash", () => {
  it("is deterministic", () => {
    const a = leafHash("bot_a", "1", "home_win", 1717804800000);
    const b = leafHash("bot_a", "1", "home_win", 1717804800000);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any field changes", () => {
    const base = leafHash("bot_a", "1", "home_win", 1);
    expect(leafHash("bot_b", "1", "home_win", 1)).not.toBe(base);
    expect(leafHash("bot_a", "2", "home_win", 1)).not.toBe(base);
    expect(leafHash("bot_a", "1", "draw", 1)).not.toBe(base);
    expect(leafHash("bot_a", "1", "home_win", 2)).not.toBe(base);
  });
});

describe("merkle , build + verify", () => {
  it("empty picks produce a 64-hex root and zero proofs", () => {
    const tree = buildMerkle([]);
    expect(tree.root).toMatch(/^[0-9a-f]{64}$/);
    expect(tree.proofs).toHaveLength(0);
    expect(tree.leaves).toHaveLength(0);
  });

  it("single-pick tree has root == leaf", () => {
    const picks: PickLeaf[] = [
      { bot_id: "bot_a", match_id: "1", outcome: "home_win", t: 1 },
    ];
    const tree = buildMerkle(picks);
    expect(tree.root).toBe(tree.leaves[0]);
    expect(tree.proofs[0]).toEqual([]);
    expect(verifyProof(tree.leaves[0]!, tree.proofs[0]!, tree.root)).toBe(
      true,
    );
  });

  it("produces a valid root + per-leaf inclusion proof", () => {
    const picks: PickLeaf[] = [
      { bot_id: "bot_a", match_id: "1", outcome: "home_win", t: 1 },
      { bot_id: "bot_b", match_id: "1", outcome: "draw", t: 2 },
      { bot_id: "bot_c", match_id: "1", outcome: "away_win", t: 3 },
      { bot_id: "bot_d", match_id: "1", outcome: "home_win", t: 4 },
    ];
    const tree = buildMerkle(picks);
    expect(tree.root).toMatch(/^[0-9a-f]{64}$/);
    for (let i = 0; i < picks.length; i++) {
      const leaf = leafHash(
        picks[i]!.bot_id,
        picks[i]!.match_id,
        picks[i]!.outcome,
        picks[i]!.t,
      );
      expect(verifyProof(leaf, tree.proofs[i]!, tree.root)).toBe(true);
    }
  });

  it("handles odd leaf counts by duplicating the trailing node", () => {
    const picks: PickLeaf[] = [
      { bot_id: "bot_a", match_id: "1", outcome: "home_win", t: 1 },
      { bot_id: "bot_b", match_id: "1", outcome: "draw", t: 2 },
      { bot_id: "bot_c", match_id: "1", outcome: "away_win", t: 3 },
    ];
    const tree = buildMerkle(picks);
    for (let i = 0; i < picks.length; i++) {
      const leaf = leafHash(
        picks[i]!.bot_id,
        picks[i]!.match_id,
        picks[i]!.outcome,
        picks[i]!.t,
      );
      expect(verifyProof(leaf, tree.proofs[i]!, tree.root)).toBe(true);
    }
  });

  it("rejects a proof against the wrong root", () => {
    const picks: PickLeaf[] = [
      { bot_id: "bot_a", match_id: "1", outcome: "home_win", t: 1 },
      { bot_id: "bot_b", match_id: "1", outcome: "draw", t: 2 },
    ];
    const tree = buildMerkle(picks);
    const leaf = leafHash("bot_a", "1", "home_win", 1);
    expect(verifyProof(leaf, tree.proofs[0]!, "0".repeat(64))).toBe(false);
  });

  it("rejects a tampered leaf", () => {
    const picks: PickLeaf[] = [
      { bot_id: "bot_a", match_id: "1", outcome: "home_win", t: 1 },
      { bot_id: "bot_b", match_id: "1", outcome: "draw", t: 2 },
    ];
    const tree = buildMerkle(picks);
    const wrong = leafHash("bot_a", "1", "away_win", 1);
    expect(verifyProof(wrong, tree.proofs[0]!, tree.root)).toBe(false);
  });

  it("two trees with the same picks produce the same root", () => {
    const picks: PickLeaf[] = [
      { bot_id: "bot_a", match_id: "1", outcome: "home_win", t: 1 },
      { bot_id: "bot_b", match_id: "1", outcome: "draw", t: 2 },
      { bot_id: "bot_c", match_id: "1", outcome: "away_win", t: 3 },
    ];
    expect(buildMerkle(picks).root).toBe(buildMerkle(picks).root);
  });

  it("scales to 1000 leaves with consistent proofs", () => {
    const picks: PickLeaf[] = Array.from({ length: 1000 }, (_, i) => ({
      bot_id: `bot_${i}`,
      match_id: "1",
      outcome: (["home_win", "draw", "away_win"] as const)[i % 3]!,
      t: i,
    }));
    const tree = buildMerkle(picks);
    // Spot-check 10 leaves at random indices.
    for (const idx of [0, 1, 17, 256, 511, 512, 768, 998, 999]) {
      const leaf = leafHash(
        picks[idx]!.bot_id,
        picks[idx]!.match_id,
        picks[idx]!.outcome,
        picks[idx]!.t,
      );
      expect(verifyProof(leaf, tree.proofs[idx]!, tree.root)).toBe(true);
    }
  });
});
