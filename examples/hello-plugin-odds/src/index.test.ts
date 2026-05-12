import { describe, expect, it } from "vitest";

import factory, { syntheticProbabilities } from "./index";

const ctx = {} as never;

describe("hello-odds", () => {
  it("returns implied probabilities that sum to 1.0", async () => {
    const { oddsSource } = factory(ctx);
    const sample = await oddsSource.fetchProbabilities("fra-vs-arg-2026");
    expect(sample).not.toBeNull();
    const total =
      sample!.outcomes.home_win +
      sample!.outcomes.draw +
      sample!.outcomes.away_win;
    expect(total).toBeGreaterThan(0.98);
    expect(total).toBeLessThan(1.02);
  });

  it("is deterministic for the same matchId", () => {
    const a = syntheticProbabilities("nzl-vs-bra-2026");
    const b = syntheticProbabilities("nzl-vs-bra-2026");
    expect(a).toEqual(b);
  });

  it("varies between matchIds", () => {
    const a = syntheticProbabilities("nzl-vs-bra-2026");
    const b = syntheticProbabilities("eng-vs-usa-2026");
    expect(a).not.toEqual(b);
  });

  it("flags freshness as zero seconds stale", async () => {
    const { oddsSource } = factory(ctx);
    const sample = await oddsSource.fetchProbabilities("m1");
    expect(sample!.stalenessSeconds).toBe(0);
  });
});
