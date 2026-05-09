import { describe, it, expect } from "vitest";
import { referralInviteCard } from "../src/cards/referral-invite.js";
import { containsText } from "./helpers.js";

const baseInput = {
  userHandle: "tane",
  userId: "u_222",
  bonusTokens: 25,
  tournamentName: "World Cup 2026",
};

describe("referral-invite card", () => {
  it("renders both sizes", () => {
    expect(() => referralInviteCard(baseInput, "og")).not.toThrow();
    expect(() => referralInviteCard(baseInput, "story")).not.toThrow();
  });

  it("uses default headline keyed off the tournament name", () => {
    const node = referralInviteCard(baseInput, "og");
    expect(containsText(node, "@tane wants you in for the World Cup 2026")).toBe(true);
  });

  it("uses generic default headline when no tournament", () => {
    const node = referralInviteCard(
      { ...baseInput, tournamentName: undefined },
      "og",
    );
    expect(containsText(node, "@tane wants you on VTourn.")).toBe(true);
  });

  it("respects an explicit inviteHeadline override", () => {
    const node = referralInviteCard(
      {
        ...baseInput,
        inviteHeadline: "Get in here. The bracket closes Friday.",
      },
      "story",
    );
    expect(containsText(node, "Get in here.")).toBe(true);
  });

  it("renders the bonus tokens prominently", () => {
    const node = referralInviteCard(baseInput, "og");
    expect(containsText(node, "+25")).toBe(true);
    expect(containsText(node, "bonus tokens on signup")).toBe(true);
  });

  it("handles zero bonus tokens", () => {
    const node = referralInviteCard({ ...baseInput, bonusTokens: 0 }, "og");
    expect(containsText(node, "+0")).toBe(true);
  });
});
