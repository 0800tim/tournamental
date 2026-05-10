import { describe, it, expect } from "vitest";
import { bracketPickCard } from "../src/cards/bracket-pick.js";
import { buildCard } from "../src/cards/index.js";
import { containsText, walkText } from "./helpers.js";
import type { BracketPickInput } from "../src/types.js";

const baseInput: BracketPickInput = {
  userHandle: "messi-fan",
  userId: "u_42",
  tournamentName: "FIFA World Cup 2026",
  winnerCode: "ARG",
  winnerName: "Argentina",
  winnerFlagEmoji: "🇦🇷",
  route: [
    { stage: "R16", teamCode: "ARG", teamName: "Argentina", flagEmoji: "🇦🇷" },
    { stage: "QF", teamCode: "BRA", teamName: "Brazil", flagEmoji: "🇧🇷" },
    { stage: "SF", teamCode: "FRA", teamName: "France", flagEmoji: "🇫🇷" },
    { stage: "FINAL", teamCode: "ARG", teamName: "Argentina", flagEmoji: "🇦🇷" },
  ],
};

describe("bracket-pick card", () => {
  it("renders both OG and story variants without throwing", () => {
    expect(() => bracketPickCard(baseInput, "og")).not.toThrow();
    expect(() => bracketPickCard(baseInput, "story")).not.toThrow();
  });

  it("spotlights the winner team name", () => {
    const node = bracketPickCard(baseInput, "og");
    expect(containsText(node, "Argentina")).toBe(true);
  });

  it("includes the user handle and tournament name", () => {
    const node = bracketPickCard(baseInput, "og");
    expect(containsText(node, "messi-fan")).toBe(true);
    expect(containsText(node, "FIFA World Cup 2026")).toBe(true);
  });

  it("renders the route strip with R16, QF, SF, F labels", () => {
    const text = walkText(bracketPickCard(baseInput, "og"));
    expect(text).toContain("R16");
    expect(text).toContain("QF");
    expect(text).toContain("SF");
    expect(text).toContain("F");
  });

  it("renders the route team codes", () => {
    const text = walkText(bracketPickCard(baseInput, "og"));
    expect(text).toContain("ARG");
    expect(text).toContain("BRA");
    expect(text).toContain("FRA");
  });

  it("uses the default tagline when none is supplied", () => {
    expect(containsText(bracketPickCard(baseInput, "og"), "lift the trophy")).toBe(true);
  });

  it("renders an overridden tagline", () => {
    const node = bracketPickCard({ ...baseInput, tagline: "Vamos Argentina!" }, "og");
    expect(containsText(node, "Vamos Argentina!")).toBe(true);
  });

  it("shows long-shot count when provided", () => {
    const node = bracketPickCard({ ...baseInput, longShotCount: 3 }, "og");
    expect(containsText(node, "+3 long-shot picks")).toBe(true);
  });

  it("omits long-shot pill when zero or undefined", () => {
    expect(containsText(bracketPickCard(baseInput, "og"), "long-shot")).toBe(false);
    expect(containsText(bracketPickCard({ ...baseInput, longShotCount: 0 }, "og"), "long-shot")).toBe(false);
  });

  it("renders winner flag emoji when provided", () => {
    const node = bracketPickCard(baseInput, "og");
    expect(containsText(node, "🇦🇷")).toBe(true);
  });

  it("survives a missing winner flag emoji", () => {
    const { winnerFlagEmoji, ...rest } = baseInput;
    void winnerFlagEmoji;
    expect(() => bracketPickCard(rest, "og")).not.toThrow();
  });

  it("clamps a very long winner team name", () => {
    const long: BracketPickInput = {
      ...baseInput,
      winnerName: "An Extraordinarily Long Country Name That Will Be Clamped",
    };
    const text = walkText(bracketPickCard(long, "og"));
    expect(text).toContain("…");
  });

  it("is exhaustive in buildCard switch", () => {
    expect(() => buildCard({ kind: "bracket-pick", data: baseInput }, "og")).not.toThrow();
  });

  it("renders for the story (1080x1920) variant", () => {
    const node = bracketPickCard(baseInput, "story");
    expect(containsText(node, "Argentina")).toBe(true);
  });

  it("renders gracefully when route has fewer than 4 stages", () => {
    const partial: BracketPickInput = {
      ...baseInput,
      route: baseInput.route.slice(0, 2),
    };
    expect(() => bracketPickCard(partial, "og")).not.toThrow();
  });
});
