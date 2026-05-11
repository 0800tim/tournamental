/**
 * MatchPredictionRow enrichment — post-cleanup contract.
 *
 * Following the 2026-05-11 "cluttered MPR cleanup" (commit db4c7b4),
 * FormDots and the HeadToHeadPill were removed from MatchPredictionRow.
 * The row now renders flag + team code + W/D/L percentage on each side
 * and that's it. These tests pin the new contract:
 *
 *   - FormDots are NOT rendered (props are accepted but ignored for
 *     rendering — kept on the public type so callers don't break).
 *   - HeadToHeadPill is NOT rendered.
 *   - The kit-coloured selection ring is still applied to the picked
 *     flag — that's the visual hook the user relies on to confirm
 *     their pick.
 *
 * Public props are still backwards compatible: every optional prop the
 * old tests passed is still accepted.
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
  kit: { primary: "#75AADB", secondary: "#FFFFFF" },
} as const;

const AWAY = {
  id: "FRA",
  name: "France",
  country: "FRA",
  fifa_rank: 2,
  pre_tournament_implied_win: 0.5,
  kit: { primary: "#0055A4", secondary: "#FFFFFF" },
} as const;

describe("MatchPredictionRow — enrichment", () => {
  it("does NOT render form dots after the cluttered-MPR cleanup", () => {
    const { container } = render(
      <MatchPredictionRow
        matchId="m1"
        homeTeam={HOME}
        awayTeam={AWAY}
        homeForm={["W", "W", "D", "L", "W"]}
        awayForm={["L", "D", "W", "W", "L"]}
        headToHead={null}
        onChange={() => {}}
      />,
    );
    expect(container.querySelectorAll(".fd-dot")).toHaveLength(0);
  });

  it("does NOT render the H2H pill after the cluttered-MPR cleanup", () => {
    const { container } = render(
      <MatchPredictionRow
        matchId="m1"
        homeTeam={HOME}
        awayTeam={AWAY}
        homeForm={["W", "W", "W", "W", "W"]}
        awayForm={["L", "L", "L", "L", "L"]}
        headToHead={{ homeWins: 2, draws: 1, awayWins: 1 }}
        onChange={() => {}}
      />,
    );
    expect(container.querySelector(".mpr-h2h")).toBeNull();
  });

  it("omits the H2H pill when headToHead is explicitly null", () => {
    const { container } = render(
      <MatchPredictionRow
        matchId="m1"
        homeTeam={HOME}
        awayTeam={AWAY}
        homeForm={[]}
        awayForm={[]}
        headToHead={null}
        onChange={() => {}}
      />,
    );
    expect(container.querySelector(".mpr-h2h")).toBeNull();
  });

  it("applies the kit-coloured selection ring to the picked flag only", () => {
    const { container } = render(
      <MatchPredictionRow
        matchId="m1"
        homeTeam={HOME}
        awayTeam={AWAY}
        prediction={{
          matchId: "m1",
          outcome: "home_win",
          lockedAt: "2026-05-15T00:00:00Z",
        }}
        homeForm={[]}
        awayForm={[]}
        headToHead={null}
        onChange={() => {}}
      />,
    );

    const homePick = container.querySelector(".mpr-pick-home") as HTMLElement;
    const awayPick = container.querySelector(".mpr-pick-away") as HTMLElement;
    const homeFlagWrap = homePick.querySelector(
      "[data-selection-ring='true']",
    ) as HTMLElement | null;
    const awayFlagWrap = awayPick.querySelector(
      "[data-selection-ring='true']",
    ) as HTMLElement | null;
    expect(homeFlagWrap).not.toBeNull();
    expect(awayFlagWrap).toBeNull();
    expect(homeFlagWrap!.style.outline).toContain("3px");
    expect(homeFlagWrap!.style.outline).toContain(HOME.kit.primary);
    // The unpicked side dims (data hook the CSS reads).
    const awayDim = awayPick.querySelector(
      "[data-dim='true']",
    ) as HTMLElement | null;
    expect(awayDim).not.toBeNull();
  });

  it("backwards-compatible: callers may still pass homeForm/awayForm/headToHead", () => {
    // The cleanup removed FormDots + H2H but kept the prop surface so
    // existing callers don't need to be updated in lockstep.
    expect(() =>
      render(
        <MatchPredictionRow
          matchId="m1"
          homeTeam={HOME}
          awayTeam={AWAY}
          homeForm={["W"]}
          awayForm={["L"]}
          headToHead={{ homeWins: 1, draws: 0, awayWins: 0 }}
          onChange={() => {}}
        />,
      ),
    ).not.toThrow();
  });
});
