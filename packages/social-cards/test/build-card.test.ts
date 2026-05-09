import { describe, it, expect } from "vitest";
import { buildCard } from "../src/cards/index.js";
import type { CardInput } from "../src/types.js";
import { containsText } from "./helpers.js";

describe("buildCard: discriminated dispatch", () => {
  const cases: CardInput[] = [
    {
      kind: "bracket-prediction",
      data: {
        userHandle: "u",
        userId: "id",
        tournamentName: "WC 2026",
        picks: [{ round: "F", pick: "ARG" }],
      },
    },
    {
      kind: "goal-clip",
      data: {
        userHandle: "u",
        userId: "id",
        tournamentName: "WC 2026",
        matchLabel: "ARG vs FRA",
        scorer: "Messi",
        scoreTeam0: 1,
        scoreTeam1: 0,
        team0Code: "ARG",
        team1Code: "FRA",
        minute: 23,
      },
    },
    {
      kind: "match-result",
      data: {
        userHandle: "u",
        userId: "id",
        tournamentName: "WC 2026",
        matchLabel: "ARG vs FRA",
        team0Code: "ARG",
        team1Code: "FRA",
        scoreTeam0: 1,
        scoreTeam1: 0,
        pointsEarned: 10,
      },
    },
    {
      kind: "leaderboard-rank",
      data: {
        userHandle: "u",
        userId: "id",
        scope: "global",
        scopeLabel: "Global",
        rank: 1,
        totalEntrants: 100,
      },
    },
    {
      kind: "badge-earned",
      data: {
        userHandle: "u",
        userId: "id",
        badgeSlug: "x",
        badgeTitle: "X",
        badgeTier: "bronze",
        badgeDescription: "y",
      },
    },
    {
      kind: "referral-invite",
      data: {
        userHandle: "u",
        userId: "id",
        bonusTokens: 5,
      },
    },
    {
      kind: "tournament-recap",
      data: {
        userHandle: "u",
        userId: "id",
        tournamentName: "WC 2026",
        predictionsLocked: 1,
        correctPredictions: 1,
        pointsEarned: 1,
        rankFinal: 1,
        totalEntrants: 1,
      },
    },
  ];

  it("produces a non-empty tree for every kind in og + story", () => {
    for (const c of cases) {
      const og = buildCard(c, "og");
      const story = buildCard(c, "story");
      expect(og.type).toBe("div");
      expect(story.type).toBe("div");
      expect(containsText(og, "VTOURN")).toBe(true);
      expect(containsText(story, "VTOURN")).toBe(true);
    }
  });

  it("every card includes the user handle in the footer", () => {
    for (const c of cases) {
      const node = buildCard(c, "og");
      expect(containsText(node, "@u")).toBe(true);
    }
  });

  it("every card includes the referral URL footer", () => {
    for (const c of cases) {
      const node = buildCard(c, "og");
      expect(containsText(node, "vtourn.com/r/id")).toBe(true);
    }
  });
});
