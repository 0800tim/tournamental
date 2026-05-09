import { describe, it, expect } from "vitest";
import { tournamentRecapCard } from "../src/cards/tournament-recap.js";
import { containsText } from "./helpers.js";

const baseInput = {
  userHandle: "ngaire",
  userId: "u_333",
  tournamentName: "World Cup 2026",
  predictionsLocked: 50,
  correctPredictions: 32,
  pointsEarned: 1840,
  rankFinal: 412,
  totalEntrants: 412300,
  highlights: [
    "Called the Argentina–France final exact score",
    "Predicted 4 Messi goals across the tournament",
    "Top-50 weekly four times in a row",
  ],
};

describe("tournament-recap card", () => {
  it("renders both sizes", () => {
    expect(() => tournamentRecapCard(baseInput, "og")).not.toThrow();
    expect(() => tournamentRecapCard(baseInput, "story")).not.toThrow();
  });

  it("includes the tournament name and key stats", () => {
    const node = tournamentRecapCard(baseInput, "story");
    expect(containsText(node, "World Cup 2026")).toBe(true);
    expect(containsText(node, "1840")).toBe(true);
    expect(containsText(node, "#412")).toBe(true);
    expect(containsText(node, "of 412,300")).toBe(true);
  });

  it("computes accuracy percentage correctly", () => {
    const node = tournamentRecapCard(baseInput, "og");
    expect(containsText(node, "64%")).toBe(true);
  });

  it("survives 0 predictions without divide-by-zero", () => {
    const node = tournamentRecapCard(
      { ...baseInput, predictionsLocked: 0, correctPredictions: 0 },
      "og",
    );
    expect(containsText(node, "0%")).toBe(true);
  });

  it("limits highlights to the first 3 even when more provided", () => {
    const many = {
      ...baseInput,
      highlights: ["one", "two", "three", "four", "five"],
    };
    const node = tournamentRecapCard(many, "og");
    expect(containsText(node, "one")).toBe(true);
    expect(containsText(node, "three")).toBe(true);
    expect(containsText(node, "four")).toBe(false);
  });

  it("omits the highlights block when none provided", () => {
    const node = tournamentRecapCard({ ...baseInput, highlights: [] }, "og");
    expect(containsText(node, "Highlights for")).toBe(false);
  });

  it("clamps a very long highlight line", () => {
    const long = {
      ...baseInput,
      highlights: ["x".repeat(200)],
    };
    const node = tournamentRecapCard(long, "og");
    expect(JSON.stringify(node)).toContain("…");
  });
});
