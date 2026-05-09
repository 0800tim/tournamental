import { describe, it, expect } from "vitest";
import { leaderboardRankCard } from "../src/cards/leaderboard-rank.js";
import { containsText } from "./helpers.js";

const baseInput = {
  userHandle: "kiri",
  userId: "u_99",
  scope: "global" as const,
  scopeLabel: "Global",
  rank: 87,
  totalEntrants: 412300,
  weeklyMove: 23,
};

describe("leaderboard-rank card", () => {
  it("renders both sizes", () => {
    expect(() => leaderboardRankCard(baseInput, "og")).not.toThrow();
    expect(() => leaderboardRankCard(baseInput, "story")).not.toThrow();
  });

  it("shows rank with hash-prefix and total entrants", () => {
    const node = leaderboardRankCard(baseInput, "og");
    expect(containsText(node, "#87")).toBe(true);
    expect(containsText(node, "of 412,300")).toBe(true);
  });

  it("shows the scope label", () => {
    const node = leaderboardRankCard(
      { ...baseInput, scope: "country", scopeLabel: "Argentina" },
      "story",
    );
    expect(containsText(node, "Argentina leaderboard")).toBe(true);
  });

  it("flags positive weekly moves with ▲", () => {
    const node = leaderboardRankCard(baseInput, "og");
    expect(containsText(node, "▲ 23 this week")).toBe(true);
  });

  it("flags negative weekly moves with ▼", () => {
    const node = leaderboardRankCard({ ...baseInput, weeklyMove: -7 }, "og");
    expect(containsText(node, "▼ 7 this week")).toBe(true);
  });

  it("hides the move badge when weeklyMove is 0 or undefined", () => {
    const a = leaderboardRankCard({ ...baseInput, weeklyMove: 0 }, "og");
    const b = leaderboardRankCard({ ...baseInput, weeklyMove: undefined }, "og");
    expect(containsText(a, "this week")).toBe(false);
    expect(containsText(b, "this week")).toBe(false);
  });

  it("includes the @handle and 'Catch me' callout", () => {
    const node = leaderboardRankCard(baseInput, "story");
    expect(containsText(node, "@kiri")).toBe(true);
    expect(containsText(node, "Catch me.")).toBe(true);
  });
});
