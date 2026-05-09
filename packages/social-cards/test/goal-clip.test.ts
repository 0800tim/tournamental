import { describe, it, expect } from "vitest";
import { goalClipCard } from "../src/cards/goal-clip.js";
import { containsText } from "./helpers.js";

const baseInput = {
  userHandle: "pat-akl",
  userId: "u_77",
  tournamentName: "World Cup 2026",
  matchLabel: "ARG vs FRA — Final",
  scorer: "Lionel Messi",
  scoreTeam0: 3,
  scoreTeam1: 2,
  team0Code: "ARG",
  team1Code: "FRA",
  minute: 78,
  predictedByUser: true,
};

describe("goal-clip card", () => {
  it("renders both sizes", () => {
    expect(() => goalClipCard(baseInput, "og")).not.toThrow();
    expect(() => goalClipCard(baseInput, "story")).not.toThrow();
  });

  it("shows GOAL banner with the minute", () => {
    const node = goalClipCard(baseInput, "og");
    expect(containsText(node, "Goal • 78'")).toBe(true);
  });

  it("renders the scorer name", () => {
    const node = goalClipCard(baseInput, "og");
    expect(containsText(node, "Lionel Messi")).toBe(true);
  });

  it("renders both team codes and scores", () => {
    const node = goalClipCard(baseInput, "story");
    expect(containsText(node, "ARG")).toBe(true);
    expect(containsText(node, "FRA")).toBe(true);
    expect(containsText(node, "3")).toBe(true);
    expect(containsText(node, "2")).toBe(true);
  });

  it("highlights the user when they predicted the goal", () => {
    const node = goalClipCard(baseInput, "og");
    expect(containsText(node, "pat-akl")).toBe(true);
    expect(containsText(node, "called this goal")).toBe(true);
  });

  it("omits the called-this banner when the user did not predict", () => {
    const node = goalClipCard({ ...baseInput, predictedByUser: false }, "og");
    expect(containsText(node, "called this goal")).toBe(false);
  });

  it("truncates a very long scorer name", () => {
    const node = goalClipCard(
      { ...baseInput, scorer: "The Player Whose Real Full Name Goes Way Too Long For A Card" },
      "og",
    );
    const json = JSON.stringify(node);
    expect(json).toContain("…");
  });

  it("handles missing handle by still rendering the footer (handle is required, smoke test)", () => {
    // userHandle is required by the type — pass an empty-ish minimal handle and
    // confirm the footer doesn't crash the builder.
    const node = goalClipCard({ ...baseInput, userHandle: "x" }, "og");
    expect(containsText(node, "@x")).toBe(true);
  });
});
