/**
 * Verified-Pundit badge tests.
 *
 *   - The footer renders an SVG-bearing badge node when input.pundit.verified.
 *   - No badge node when verified is false / missing.
 *   - Levels >= 2 emits the "×N" chip alongside the bubble.
 *   - The OG card includes the verified-pundit marker text when verified.
 */

import { describe, it, expect } from "vitest";

import { matchResultCard } from "../src/cards/match-result.js";
import { containsText, walkAll } from "./helpers.js";
import type { SatoriElement } from "../src/jsdl.js";

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

function findBadgeNodes(root: SatoriElement): SatoriElement[] {
  const out: SatoriElement[] = [];
  walkAll(root, (n) => {
    const props = (n.props ?? {}) as Record<string, unknown>;
    if (props["data-testid"] === "pundit-badge") out.push(n);
  });
  return out;
}

describe("verified-pundit badge in social cards", () => {
  it("omits the badge when input.pundit is undefined", () => {
    const node = matchResultCard(baseInput, "og");
    expect(findBadgeNodes(node)).toHaveLength(0);
    expect(containsText(node, "Verified Pundit")).toBe(false);
  });

  it("omits the badge when verified is false", () => {
    const node = matchResultCard(
      {
        ...baseInput,
        pundit: { verified: false, levels: 0 },
      },
      "og",
    );
    expect(findBadgeNodes(node)).toHaveLength(0);
  });

  it("renders the badge when the user is verified", () => {
    const node = matchResultCard(
      {
        ...baseInput,
        pundit: {
          verified: true,
          levels: 1,
          sinceDate: "2026-04-01T00:00:00Z",
          tournaments: ["fifa-wc-2026"],
        },
      },
      "og",
    );
    const badges = findBadgeNodes(node);
    expect(badges).toHaveLength(1);
    expect(
      (badges[0].props as Record<string, string>)["data-pundit-levels"],
    ).toBe("1");
    // The accessible marker text travels with the satori tree.
    expect(containsText(node, "Verified Pundit")).toBe(true);
  });

  it("renders the badge in the story size as well", () => {
    const node = matchResultCard(
      {
        ...baseInput,
        pundit: { verified: true, levels: 1, sinceDate: null, tournaments: [] },
      },
      "story",
    );
    expect(findBadgeNodes(node)).toHaveLength(1);
  });

  it("emits the levels chip when levels >= 2", () => {
    const node = matchResultCard(
      {
        ...baseInput,
        pundit: {
          verified: true,
          levels: 4,
          sinceDate: "2025-12-18T00:00:00Z",
          tournaments: ["a", "b", "c", "d"],
        },
      },
      "og",
    );
    expect(containsText(node, "×4")).toBe(true);
  });
});
