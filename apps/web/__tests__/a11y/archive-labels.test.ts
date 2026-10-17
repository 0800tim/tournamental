import { describe, expect, it } from "vitest";

import { knockoutLinkLabel, knockoutScoreText } from "@/lib/archive/labels";

describe("archive knockout link names", () => {
  it("formats the score with the method suffix", () => {
    expect(knockoutScoreText({ homeScore: 1, awayScore: 0, method: "et" })).toBe("1-0 aet");
    expect(knockoutScoreText({ homeScore: 4, awayScore: 6, method: "pens" })).toBe("6-4 pens");
    expect(knockoutScoreText({ homeScore: 2, awayScore: 1, method: null })).toBe("2-1");
    expect(knockoutScoreText({ homeScore: null, awayScore: null, method: null })).toBe("won");
  });

  it("gives every Match link a distinct, descriptive name", () => {
    expect(knockoutLinkLabel("Final", "Spain", { homeScore: 1, awayScore: 0, method: "et" })).toBe(
      "Match details: Final, Spain won 1-0 aet",
    );
    expect(knockoutLinkLabel("Round of 16", "Morocco", { homeScore: null, awayScore: null, method: null })).toBe(
      "Match details: Round of 16, Morocco won",
    );
  });
});
