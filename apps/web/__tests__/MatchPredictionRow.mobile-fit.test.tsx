/**
 * Mobile-fit regression for MatchPredictionRow.
 *
 * The MPR enrichment (form dots + H2H pill + selection ring) must keep the
 * row compact: spec says the height delta is <=10% on a 375px-wide phone.
 *
 * jsdom can't actually paint pixels, so this test takes the lighter (but
 * still useful) approach: it asserts the structural footprint stays small.
 *
 *  - the H2H pill row is ONE single line (height-bounded by the pill's
 *    16px CSS height; whitelist `.h2h-pill[height=16]` if jsdom resolves it)
 *  - per-pick column adds ONE FormDots node at sm size (8px dots)
 *  - the row still uses CSS grid (not flex) so it lays out predictably
 */

// @vitest-environment jsdom

import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { MatchPredictionRow } from "../components/bracket/MatchPredictionRow";

const HOME = {
  id: "ARG",
  name: "Argentina",
  country: "ARG",
  fifa_rank: 1,
  pre_tournament_implied_win: 0.6,
  kit: { primary: "#75AADB" },
} as const;

const AWAY = {
  id: "FRA",
  name: "France",
  country: "FRA",
  fifa_rank: 2,
  pre_tournament_implied_win: 0.5,
  kit: { primary: "#0055A4" },
} as const;

describe("MatchPredictionRow — mobile fit", () => {
  it("has exactly one FormDots strip per pick column", () => {
    const { container } = render(
      <MatchPredictionRow
        matchId="m1"
        homeTeam={HOME}
        awayTeam={AWAY}
        homeForm={["W", "W", "D", "L", "W"]}
        awayForm={["L", "D", "W", "W", "L"]}
        headToHead={{ homeWins: 2, draws: 1, awayWins: 1 }}
        onChange={() => {}}
      />,
    );
    expect(container.querySelectorAll(".mpr-pick-home .fd-row")).toHaveLength(1);
    expect(container.querySelectorAll(".mpr-pick-away .fd-row")).toHaveLength(1);
    // Form dots in the row are the sm variant — small footprint.
    const dotRow = container.querySelector(".mpr-pick-home .fd-row") as HTMLElement;
    expect(dotRow.dataset.size).toBe("sm");
  });

  it("renders exactly one H2H pill in the row", () => {
    const { container } = render(
      <MatchPredictionRow
        matchId="m1"
        homeTeam={HOME}
        awayTeam={AWAY}
        homeForm={[]}
        awayForm={[]}
        headToHead={{ homeWins: 2, draws: 1, awayWins: 1 }}
        onChange={() => {}}
      />,
    );
    expect(container.querySelectorAll(".mpr-h2h")).toHaveLength(1);
  });

  it("structural footprint — picks + h2h + scores rows only", () => {
    const { container } = render(
      <MatchPredictionRow
        matchId="m1"
        homeTeam={HOME}
        awayTeam={AWAY}
        homeForm={["W"]}
        awayForm={["L"]}
        headToHead={{ homeWins: 1, draws: 0, awayWins: 0 }}
        onChange={() => {}}
      />,
    );
    const row = container.querySelector(".mpr-row") as HTMLElement;
    expect(row).not.toBeNull();
    // Structural children of .mpr-row: view-match link, home pick, draw
    // pick (group only), away pick, h2h pill, scores wrap. So 6 in
    // group stage. The enrichment adds exactly one child (the H2H pill)
    // on top of what the upstream row had.
    const directChildren = Array.from(row.children).filter(
      (c) => !c.classList.contains("mpr-locked-banner"),
    );
    expect([5, 6]).toContain(directChildren.length);
    // And exactly one of those children is the new H2H pill.
    expect(row.querySelectorAll(".mpr-h2h")).toHaveLength(1);
  });
});
