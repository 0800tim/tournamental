/**
 * Unit tests for the within-swarm uniqueness perturbation algorithm.
 *
 * Verifies that:
 *   - Bot 0 is the pure chalk bracket (no deviations).
 *   - Bots 1..S each flip exactly one outcome relative to chalk, and
 *     the flips are all distinct (single-deviation coverage).
 *   - For an arbitrary swarm of N bots, every pair of bots produces a
 *     structurally distinct bracket (no two bots ever share all 104
 *     outcomes).
 *   - The unranking is deterministic across calls.
 */

import { describe, expect, it } from "vitest";

import { buildDemoMatches } from "@/components/browser-swarm/regenerate";
import {
  buildDeviationTable,
  deviationSlotsForBotIndex,
  perturbedBracket,
  singleDeviationCount,
} from "@/components/browser-swarm/uniqueness";

describe("browser-swarm uniqueness", () => {
  it("bot 0 is the pure chalk bracket (no deviations)", () => {
    const matches = buildDemoMatches();
    const table = buildDeviationTable(matches);
    const b0 = perturbedBracket(table, 0);
    expect(b0).toEqual([...table.favouriteByMatchIdx]);
  });

  it("bots 1..S flip exactly one outcome each", () => {
    const matches = buildDemoMatches();
    const table = buildDeviationTable(matches);
    const S = singleDeviationCount(table);
    expect(S).toBeGreaterThan(0);
    const chalk = perturbedBracket(table, 0);
    for (let i = 1; i <= S; i++) {
      const bracket = perturbedBracket(table, i);
      let diffs = 0;
      for (let m = 0; m < chalk.length; m++) {
        if (bracket[m] !== chalk[m]) diffs++;
      }
      expect(diffs).toBe(1);
    }
  });

  it("single-deviation brackets are all distinct from each other", () => {
    const matches = buildDemoMatches();
    const table = buildDeviationTable(matches);
    const S = singleDeviationCount(table);
    const seen = new Set<string>();
    for (let i = 0; i <= S; i++) {
      const key = perturbedBracket(table, i).join("|");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("two distinct bot indices produce structurally distinct brackets", () => {
    const matches = buildDemoMatches();
    const table = buildDeviationTable(matches);
    const N = 200; // covers chalk + all single + into the double level
    const seen = new Set<string>();
    for (let i = 0; i < N; i++) {
      const key = perturbedBracket(table, i).join("|");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("returns the same deviation set across repeat unranking calls", () => {
    const matches = buildDemoMatches();
    const table = buildDeviationTable(matches);
    for (const idx of [0, 1, 42, 999, 4321]) {
      const a = deviationSlotsForBotIndex(idx, table.slots.length);
      const b = deviationSlotsForBotIndex(idx, table.slots.length);
      expect([...a]).toEqual([...b]);
    }
  });

  it("double-deviation level kicks in at rank S+1", () => {
    const matches = buildDemoMatches();
    const table = buildDeviationTable(matches);
    const S = singleDeviationCount(table);
    const firstDouble = deviationSlotsForBotIndex(S + 1, table.slots.length);
    expect(firstDouble.length).toBe(2);
    const lastSingle = deviationSlotsForBotIndex(S, table.slots.length);
    expect(lastSingle.length).toBe(1);
  });
});
