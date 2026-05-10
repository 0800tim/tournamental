/**
 * MatchPredictionRow enrichment — verifies the new ornaments added on top
 * of the existing two-flag/draw UX:
 *
 *   - per-team FormDots inline under each flag
 *   - HeadToHeadPill centred between the two picks (when h2h data exists)
 *   - kit-coloured selection ring on the chosen flag, others lose it
 *
 * Public props are still backwards compatible: the only new ones are
 * optional (homeForm / awayForm / headToHead overrides for tests).
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
  it("renders form dots under each flag", () => {
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
    const homePick = container.querySelector(".mpr-pick-home") as HTMLElement;
    const awayPick = container.querySelector(".mpr-pick-away") as HTMLElement;
    expect(homePick.querySelectorAll(".fd-dot")).toHaveLength(5);
    expect(awayPick.querySelectorAll(".fd-dot")).toHaveLength(5);
  });

  it("renders a centred H2H pill when head-to-head data is provided", () => {
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
    const pill = container.querySelector(".mpr-h2h") as HTMLElement;
    expect(pill).not.toBeNull();
    expect(pill.textContent).toContain("ARG");
    expect(pill.textContent).toContain("FRA");
    // Compact record format
    expect(container.textContent).toContain("2-1-1");
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

  it("falls back to bundled stub form data when overrides are omitted", () => {
    // Argentina has 5 stub games in team-form.json so dots should appear.
    const { container } = render(
      <MatchPredictionRow
        matchId="m1"
        homeTeam={HOME}
        awayTeam={AWAY}
        onChange={() => {}}
      />,
    );
    const homePick = container.querySelector(".mpr-pick-home") as HTMLElement;
    expect(homePick.querySelectorAll(".fd-dot").length).toBeGreaterThan(0);
  });
});
