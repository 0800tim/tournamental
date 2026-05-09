import { describe, it, expect } from "vitest";
import { badgeEarnedCard, _internal } from "../src/cards/badge-earned.js";
import { containsText } from "./helpers.js";

const baseInput = {
  userHandle: "rangi",
  userId: "u_111",
  badgeSlug: "messi-moment",
  badgeTitle: "Messi Moment",
  badgeTier: "gold" as const,
  badgeDescription:
    "Predicted that Messi would score in any FIFA tournament match before kickoff, then watched him find the net.",
};

describe("badge-earned card", () => {
  it("renders for every tier", () => {
    for (const tier of ["bronze", "silver", "gold", "platinum", "mythic"] as const) {
      expect(() =>
        badgeEarnedCard({ ...baseInput, badgeTier: tier }, "og"),
      ).not.toThrow();
    }
  });

  it("ships a colour and label for every tier", () => {
    for (const tier of ["bronze", "silver", "gold", "platinum", "mythic"] as const) {
      expect(_internal.TIER_COLOURS[tier]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(_internal.TIER_LABELS[tier]).toMatch(/badge/i);
    }
  });

  it("renders the tier label and badge title", () => {
    const node = badgeEarnedCard(baseInput, "story");
    expect(containsText(node, "Gold badge")).toBe(true);
    expect(containsText(node, "Messi Moment")).toBe(true);
  });

  it("renders the awarded-to handle", () => {
    const node = badgeEarnedCard(baseInput, "og");
    expect(containsText(node, "Awarded to @rangi")).toBe(true);
  });

  it("clamps a very long description", () => {
    const node = badgeEarnedCard(
      {
        ...baseInput,
        badgeDescription:
          "A lengthy description that goes on and on and on and on and on and on and on and on and on and on and on and on, far past anything we want to render in a single card",
      },
      "og",
    );
    expect(JSON.stringify(node)).toContain("…");
  });
});
