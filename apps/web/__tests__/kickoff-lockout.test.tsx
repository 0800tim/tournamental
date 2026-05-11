/**
 * Kickoff lockout, once a match has kicked off, the user cannot
 * change their prediction. The row shows a "match already started"
 * banner and the buttons go disabled (aria-disabled / disabled).
 *
 * Per Tim's spec: "lock off any changes … at kickoff (0 minutes). If
 * somebody tries to change their prediction after kickoff it should
 * say: Sorry this match has already started. You can't change it now."
 */

// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import type { MatchOdds } from "../lib/odds/types";
import { MatchPredictionRow } from "../components/bracket/MatchPredictionRow";

import type { Team } from "@vtorn/bracket-engine";

const home: Team = {
  id: "ARG",
  name: "Argentina",
  country: "AR",
  fifa_rank: 1,
  pre_tournament_implied_win: 0.4,
  kit: { primary: "#75aadb", secondary: "#ffffff" },
};
const away: Team = {
  id: "FRA",
  name: "France",
  country: "FR",
  fifa_rank: 2,
  pre_tournament_implied_win: 0.3,
  kit: { primary: "#1f2a8c", secondary: "#ffffff" },
};
const odds: MatchOdds = {
  matchNo: "1",
  homeTeam: "ARG",
  awayTeam: "FRA",
  homeWin: 0.4,
  draw: 0.3,
  awayWin: 0.3,
  source: "polymarket",
  updatedAt: new Date().toISOString(),
};

describe("Kickoff lockout", () => {
  it("blocks pick changes once kickoff has passed and shows the banner", () => {
    const onChange = vi.fn();
    const pastKickoff = new Date(Date.now() - 60_000).toISOString();
    const { container, getByText } = render(
      <MatchPredictionRow
        matchId="1"
        homeTeam={home}
        awayTeam={away}
        kickoffIso={pastKickoff}
        odds={odds}
        onChange={onChange}
      />,
    );

    expect(getByText(/match has already started/i)).toBeDefined();
    const homeBtn = container.querySelector(".mpr-pick-home") as HTMLButtonElement;
    expect(homeBtn.disabled).toBe(true);
    fireEvent.click(homeBtn);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("allows picks before kickoff and embeds the live odds snapshot in the prediction", () => {
    const onChange = vi.fn();
    const futureKickoff = new Date(Date.now() + 60 * 60_000).toISOString();
    const { container } = render(
      <MatchPredictionRow
        matchId="1"
        homeTeam={home}
        awayTeam={away}
        kickoffIso={futureKickoff}
        odds={odds}
        onChange={onChange}
      />,
    );

    const homeBtn = container.querySelector(".mpr-pick-home") as HTMLButtonElement;
    expect(homeBtn.disabled).toBe(false);
    fireEvent.click(homeBtn);
    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls[0]?.[0];
    expect(arg.outcome).toBe("home_win");
    expect(arg.oddsAtLock).toBeDefined();
    expect(arg.oddsAtLock.homeWin).toBeCloseTo(0.4, 2);
    expect(arg.oddsAtLock.source).toBe("polymarket");
    expect(typeof arg.oddsAtLock.capturedAt).toBe("string");
  });
});
