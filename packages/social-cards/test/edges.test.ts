/**
 * Edge cases that don't fit cleanly under any one card.
 */

import { describe, it, expect } from "vitest";
import { goalClipCard } from "../src/cards/goal-clip.js";
import { matchResultCard } from "../src/cards/match-result.js";
import { referralInviteCard } from "../src/cards/referral-invite.js";
import { containsText } from "./helpers.js";

describe("very long handles", () => {
  it("renders with a 64-char handle without crashing", () => {
    const node = goalClipCard(
      {
        userHandle: "x".repeat(64),
        userId: "u_1",
        tournamentName: "WC 2026",
        matchLabel: "A vs B",
        scorer: "Player",
        scoreTeam0: 1,
        scoreTeam1: 0,
        team0Code: "AAA",
        team1Code: "BBB",
        minute: 5,
      },
      "og",
    );
    expect(containsText(node, "@" + "x".repeat(64))).toBe(true);
  });
});

describe("missing optional fields", () => {
  it("match-result without prediction or pointsEarned 0", () => {
    expect(() =>
      matchResultCard(
        {
          userHandle: "u",
          userId: "i",
          tournamentName: "T",
          matchLabel: "A vs B",
          team0Code: "AAA",
          team1Code: "BBB",
          scoreTeam0: 0,
          scoreTeam1: 0,
          pointsEarned: 0,
        },
        "og",
      ),
    ).not.toThrow();
  });

  it("referral-invite without tournament", () => {
    expect(() =>
      referralInviteCard(
        { userHandle: "u", userId: "i", bonusTokens: 10 },
        "story",
      ),
    ).not.toThrow();
  });
});

describe("RTL languages render with direction:rtl", () => {
  it("Arabic handle on a referral card", () => {
    const node = referralInviteCard(
      { userHandle: "حبيب", userId: "ar_1", bonusTokens: 25, locale: "ar" },
      "story",
    );
    const json = JSON.stringify(node);
    expect(json).toContain('"direction":"rtl"');
    expect(json).toContain("حبيب");
  });

  it("Hebrew locale flips direction even though no Hebrew is in the input", () => {
    const node = referralInviteCard(
      { userHandle: "u", userId: "he_1", bonusTokens: 25, locale: "he" },
      "og",
    );
    expect(JSON.stringify(node)).toContain('"direction":"rtl"');
  });
});

describe("CJK locales", () => {
  it("Japanese handle and tournament render", () => {
    const node = goalClipCard(
      {
        userHandle: "サムライ",
        userId: "jp_1",
        tournamentName: "ワールドカップ2026",
        matchLabel: "JPN vs ARG",
        scorer: "本田",
        scoreTeam0: 1,
        scoreTeam1: 0,
        team0Code: "JPN",
        team1Code: "ARG",
        minute: 12,
        locale: "ja",
      },
      "story",
    );
    expect(containsText(node, "サムライ")).toBe(true);
    expect(containsText(node, "本田")).toBe(true);
  });
});
