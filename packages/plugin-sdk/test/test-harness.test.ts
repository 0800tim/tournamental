import { describe, expect, it } from "vitest";
import type { ScorerPlugin } from "../src/index.js";
import {
  makeFixtureMatchInit,
  makeFixtureStateFrame,
  renderFrameToPng,
  runScorerAgainstFixture,
} from "../src/test-harness.js";

describe("makeFixtureMatchInit", () => {
  it("returns a spec-conformant MatchInit", () => {
    const init = makeFixtureMatchInit();
    expect(init.type).toBe("match.init");
    expect(init.spec_version).toBe("0.1.1");
    expect(init.teams).toHaveLength(2);
    expect(init.teams[0].players).toHaveLength(3);
  });

  it("merges overrides", () => {
    const init = makeFixtureMatchInit({ match_id: "custom-match" });
    expect(init.match_id).toBe("custom-match");
  });
});

describe("makeFixtureStateFrame", () => {
  it("returns six players and one ball at t=0", () => {
    const frame = makeFixtureStateFrame();
    expect(frame.type).toBe("state");
    expect(frame.t).toBe(0);
    expect(frame.players).toHaveLength(6);
    expect(frame.ball.pos).toEqual([0, 0, 0.1]);
  });
});

describe("runScorerAgainstFixture", () => {
  const identityScorer: ScorerPlugin = {
    label: "Identity scorer (test)",
    modes: ["bracket"],
    score: (bracket) => ({
      total: bracket.predictions.length * 10,
      perPrediction: Object.fromEntries(
        bracket.predictions.map((p) => [
          p.matchId,
          { points: 10, base: 10, multipliers: {} },
        ]),
      ),
    }),
  };

  it("runs a scorer and returns the breakdown", () => {
    const breakdown = runScorerAgainstFixture(
      identityScorer,
      {
        bracketId: "B_test",
        userId: "U_test",
        mode: "bracket",
        predictions: [
          { matchId: "M1", outcome: "home_win", lockedAtMs: 0 },
          { matchId: "M2", outcome: "draw", lockedAtMs: 0 },
        ],
      },
      { actual: {} },
    );
    expect(breakdown.total).toBe(20);
    expect(Object.keys(breakdown.perPrediction)).toEqual(["M1", "M2"]);
  });

  it("throws when the scorer does not support the bracket's mode", () => {
    expect(() =>
      runScorerAgainstFixture(
        identityScorer,
        {
          bracketId: "B_test",
          userId: "U_test",
          mode: "pre_match",
          predictions: [],
        },
        { actual: {} },
      ),
    ).toThrow(/does not support mode pre_match/);
  });
});

describe("renderFrameToPng", () => {
  it("returns sentinel PNG bytes in Node (no DOM)", async () => {
    const init = makeFixtureMatchInit();
    const frame = makeFixtureStateFrame();
    const stubRenderer = {
      label: "stub",
      mount() {
        throw new Error("should not be called in Node without a DOM");
      },
    } as any;
    const bytes = await renderFrameToPng(stubRenderer, init, frame);
    // PNG magic.
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x4e);
    expect(bytes[3]).toBe(0x47);
  });
});
