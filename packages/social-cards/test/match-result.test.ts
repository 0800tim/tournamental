import { describe, it, expect } from "vitest";
import { matchResultCard } from "../src/cards/match-result.js";
import { containsText } from "./helpers.js";

const baseInput = {
  userHandle: "lily",
  userId: "u_88",
  tournamentName: "World Cup 2026",
  matchLabel: "ARG vs FRA — Final",
  team0Code: "ARG",
  team1Code: "FRA",
  scoreTeam0: 3,
  scoreTeam1: 2,
  predictedScoreTeam0: 3,
  predictedScoreTeam1: 2,
  pointsEarned: 50,
};

describe("match-result card", () => {
  it("renders both sizes", () => {
    expect(() => matchResultCard(baseInput, "og")).not.toThrow();
    expect(() => matchResultCard(baseInput, "story")).not.toThrow();
  });

  it("uses the exact-score headline when prediction matches actual", () => {
    const node = matchResultCard(baseInput, "og");
    expect(containsText(node, "Exact score. Called it.")).toBe(true);
  });

  it("uses the result-called headline when only the side is right", () => {
    const node = matchResultCard(
      { ...baseInput, predictedScoreTeam0: 2, predictedScoreTeam1: 0 },
      "og",
    );
    expect(containsText(node, "Result called.")).toBe(true);
  });

  it("uses points-banked when prediction was wrong but pts > 0", () => {
    const node = matchResultCard(
      {
        ...baseInput,
        predictedScoreTeam0: 0,
        predictedScoreTeam1: 4,
        pointsEarned: 5,
      },
      "og",
    );
    expect(containsText(node, "Points banked.")).toBe(true);
  });

  it("uses on-to-the-next when no prediction was made and 0 pts", () => {
    const node = matchResultCard(
      {
        ...baseInput,
        predictedScoreTeam0: undefined,
        predictedScoreTeam1: undefined,
        pointsEarned: 0,
      },
      "og",
    );
    expect(containsText(node, "On to the next.")).toBe(true);
  });

  it("includes the predicted score subline when provided", () => {
    const node = matchResultCard(baseInput, "story");
    expect(containsText(node, "Predicted 3–2")).toBe(true);
  });

  it("omits the predicted-score subline when not provided", () => {
    const node = matchResultCard(
      {
        ...baseInput,
        predictedScoreTeam0: undefined,
        predictedScoreTeam1: undefined,
      },
      "og",
    );
    expect(containsText(node, "Predicted")).toBe(false);
  });
});
