/**
 * ThirdsPicker reads its count, ordering and copy from the tournament.
 */
import { describe, expect, it, vi } from "vitest";
import {
  loadFixtures2026,
  loadFixturesRwc2027,
  type Bracket,
  type MatchPrediction,
  type Tournament,
} from "@tournamental/bracket-engine";

import { ThirdsPicker, autoPickBestThirds } from "@/components/bracket/ThirdsPicker";
import { fireEvent, render, screen, within } from "./helpers/render";

const rwc: Tournament = loadFixturesRwc2027();
const wc: Tournament = loadFixtures2026();

/** Every group match predicted as a home win, no score lines. */
function groupStageBracket(t: Tournament, bestThirds: string[] = []): Bracket {
  const matchPredictions: Record<string, MatchPrediction> = {};
  for (const f of t.group_fixtures) {
    matchPredictions[String(f.match_no)] = {
      matchId: String(f.match_no),
      outcome: "home_win",
      lockedAt: "",
    };
  }
  return {
    bracketId: "test",
    matchPredictions,
    groupTiebreakers: {},
    knockoutPredictions: {},
    bestThirds,
    version: 2,
  } as Bracket;
}

describe("ThirdsPicker for Rugby World Cup 2027", () => {
  it("asks for four of six thirds and routes them into the Round of 16", () => {
    const onChange = vi.fn();
    render(
      <ThirdsPicker tournament={rwc} bracket={groupStageBracket(rwc)} onChange={onChange} onClear={() => {}} />,
    );
    expect(screen.getByText(/the 4 best 3rd-placed teams \(out of 6\)/)).toBeTruthy();
    expect(screen.getByText(/World Rugby ranks those thirds by points, then points difference, points scored, tries scored, World Rugby ranking/)).toBeTruthy();
    expect(screen.getByText(/route them into the Round of 16/)).toBeTruthy();
    expect(screen.getByText("/ 4 selected", { exact: false })).toBeTruthy();
    const list = screen.getByRole("listbox", { name: "6 third-placed teams" });
    const tiles = within(list).getAllByRole("option");
    expect(tiles).toHaveLength(6);
    expect(within(list).getAllByText(/^WR \d+$/)).toHaveLength(6);
    expect(screen.getByText("Pick 4 more to unlock the Round of 16.")).toBeTruthy();
  });

  it("orders the tiles by the tournament's chain, not by team code", () => {
    render(
      <ThirdsPicker tournament={rwc} bracket={groupStageBracket(rwc)} onChange={() => {}} onClear={() => {}} />,
    );
    const names = screen.getAllByRole("option").map((o) => o.querySelector(".bracket-thirds-tile-name")?.textContent);
    const expected = autoPickBestThirds(rwc, groupStageBracket(rwc).matchPredictions, {});
    // With home wins and no scores every third has the same points, so the
    // order falls to World Rugby ranking: the auto-pick's four lead.
    const leading = names.slice(0, 4).map((n) => rwc.teams.find((t) => t.name === n)?.id).sort();
    expect(leading).toEqual([...expected].sort());
  });

  it("stops accepting picks at the tournament's count", () => {
    const onChange = vi.fn();
    const picked = rwc.groups.slice(0, 4).map((g) => g.team_ids[2]!);
    render(
      <ThirdsPicker tournament={rwc} bracket={groupStageBracket(rwc, picked)} onChange={onChange} onClear={() => {}} />,
    );
    const fifth = screen.getAllByRole("option").find((o) => o.getAttribute("aria-selected") === "false")!;
    expect(fifth.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(fifth);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText(/Pick \d+ more/)).toBeNull();
  });
});

describe("ThirdsPicker for the 2026 World Cup", () => {
  it("keeps the eight-of-twelve copy and FIFA rank badges", () => {
    render(
      <ThirdsPicker tournament={wc} bracket={groupStageBracket(wc)} onChange={() => {}} onClear={() => {}} />,
    );
    expect(screen.getByText(/the 8 best 3rd-placed teams \(out of 12\)/)).toBeTruthy();
    expect(screen.getByText(/FIFA ranks those thirds by points, then goal difference, goals scored/)).toBeTruthy();
    expect(screen.getByText("Pick 8 more to unlock the Round of 32.")).toBeTruthy();
    expect(screen.getAllByText(/^FR \d+$/)).toHaveLength(12);
  });
});

describe("autoPickBestThirds", () => {
  it("returns as many thirds as the format advances, alphabetically", () => {
    const four = autoPickBestThirds(rwc, groupStageBracket(rwc).matchPredictions, {});
    expect(four).toHaveLength(4);
    expect([...four].sort()).toEqual([...four]);
    const eight = autoPickBestThirds(wc, groupStageBracket(wc).matchPredictions, {});
    expect(eight).toHaveLength(8);
  });
});
