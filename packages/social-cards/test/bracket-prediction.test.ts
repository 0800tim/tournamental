import { describe, it, expect } from "vitest";
import { bracketPredictionCard } from "../src/cards/bracket-prediction.js";
import { containsText, walkText } from "./helpers.js";

const baseInput = {
  userHandle: "messi-fan",
  userId: "u_42",
  tournamentName: "World Cup 2026",
  picks: [
    { round: "Round 1", pick: "ARG" },
    { round: "QF", pick: "BRA" },
    { round: "SF", pick: "ARG" },
    { round: "Final", pick: "ARG" },
  ],
  predictionIq: 78.4,
};

describe("bracket-prediction card", () => {
  it("renders OG and story variants without throwing", () => {
    expect(() => bracketPredictionCard(baseInput, "og")).not.toThrow();
    expect(() => bracketPredictionCard(baseInput, "story")).not.toThrow();
  });

  it("includes the user handle and tournament name", () => {
    const node = bracketPredictionCard(baseInput, "og");
    expect(containsText(node, "messi-fan")).toBe(true);
    expect(containsText(node, "World Cup 2026")).toBe(true);
  });

  it("renders every supplied pick label", () => {
    const node = bracketPredictionCard(baseInput, "og");
    const text = walkText(node);
    expect(text).toContain("Round 1");
    expect(text).toContain("Final");
    expect(text).toContain("ARG");
  });

  it("displays Prediction IQ when provided", () => {
    const node = bracketPredictionCard(baseInput, "story");
    expect(containsText(node, "Prediction IQ 78.4")).toBe(true);
  });

  it("omits IQ when not provided", () => {
    const { predictionIq, ...rest } = baseInput;
    void predictionIq;
    const node = bracketPredictionCard(rest, "og");
    expect(containsText(node, "Prediction IQ")).toBe(false);
  });

  it("clamps a 47-pick bracket to the visible limit and shows overflow", () => {
    const longInput = {
      ...baseInput,
      picks: Array.from({ length: 47 }, (_, i) => ({
        round: `R${i}`,
        pick: `Team ${i}`,
      })),
    };
    const node = bracketPredictionCard(longInput, "og");
    expect(containsText(node, "+31 more picks")).toBe(true);
  });

  it("survives an empty pick array", () => {
    const empty = { ...baseInput, picks: [] };
    expect(() => bracketPredictionCard(empty, "og")).not.toThrow();
  });

  it("truncates a very long tournament name in the body", () => {
    const long = {
      ...baseInput,
      tournamentName: "The Extremely Long Premier Tournament Title 2026 Edition",
    };
    const node = bracketPredictionCard(long, "story");
    // The clamp() helper drops trailing chars and adds an ellipsis.
    const body = walkText(node);
    expect(body).toContain("…");
  });

  it("renders for an RTL locale (Arabic)", () => {
    const ar = { ...baseInput, locale: "ar-EG", userHandle: "حبيب" };
    const node = bracketPredictionCard(ar, "story");
    // root style should now be `direction: rtl`
    expect(JSON.stringify(node)).toContain('"direction":"rtl"');
    expect(containsText(node, "حبيب")).toBe(true);
  });
});
