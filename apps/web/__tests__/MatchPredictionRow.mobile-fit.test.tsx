/**
 * Mobile-fit regression for MatchPredictionRow.
 *
 * Following the 2026-05-11 "cluttered MPR cleanup" (commit db4c7b4),
 * the row no longer renders FormDots, the HeadToHeadPill, or the per-
 * pick info badges. The contract is now simpler: each side is a single
 * flag + team code + W/D/L percentage chip — that's it.
 *
 * jsdom can't actually paint pixels, so this test takes the lighter
 * (but still useful) approach: it asserts the structural footprint
 * stays small and the removed elements are not present.
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
  it("no FormDots strip in either pick column (cluttered-MPR cleanup)", () => {
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
    expect(container.querySelectorAll(".mpr-pick-home .fd-row")).toHaveLength(0);
    expect(container.querySelectorAll(".mpr-pick-away .fd-row")).toHaveLength(0);
  });

  it("no H2H pill in the row (cluttered-MPR cleanup)", () => {
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
    expect(container.querySelectorAll(".mpr-h2h")).toHaveLength(0);
  });

  it("structural footprint — picks + scores rows only", () => {
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
    // Structural children of .mpr-row: view-match link, popup-trigger
    // button, home pick, draw pick (group only), away pick, scores
    // wrap. So 6 in group stage (5 in knockouts when the draw is
    // hidden). The H2H pill is gone post-cleanup.
    const directChildren = Array.from(row.children).filter(
      (c) => !c.classList.contains("mpr-locked-banner"),
    );
    expect([5, 6]).toContain(directChildren.length);
    // And no H2H pill is rendered.
    expect(row.querySelectorAll(".mpr-h2h")).toHaveLength(0);
  });
});
