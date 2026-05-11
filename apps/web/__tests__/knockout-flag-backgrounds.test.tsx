/**
 * Knockout flag-as-background, verifies the visual contract introduced
 * in `feat/knockout-flag-backgrounds` (doc 46):
 *
 *   - Selected (winner) side renders `style.backgroundImage` with the
 *     flag URL pointing at `/flags/<TEAM_ID>.svg`.
 *   - Unpicked side does not render a `backgroundImage` (still receives
 *     a `--km-flag-preview` CSS-var for the hover-preview rule, but the
 *     image only paints on :hover/:focus-visible and that's a CSS
 *     concern outside JSDOM).
 *   - The inline TeamFlag chip on a knockout cell sits at the new
 *     bigger `md` size (48x32) by default, not the old `sm` (24x16).
 *   - aria-pressed flips when the user picks a side.
 *   - Match-number chip, View-match link, and connector all render in
 *     the new layout.
 */

// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { KnockoutMatch } from "../components/bracket/KnockoutMatch";
import type {
  CascadedKnockout,
  MatchPrediction,
  Team,
} from "@vtorn/bracket-engine";

const ARG: Team = {
  id: "ARG",
  name: "Argentina",
  country: "ARG",
  fifa_rank: 1,
  pre_tournament_implied_win: 0.6,
  kit: { primary: "#75AADB", secondary: "#FFFFFF" },
} as Team;

const FRA: Team = {
  id: "FRA",
  name: "France",
  country: "FRA",
  fifa_rank: 2,
  pre_tournament_implied_win: 0.5,
  kit: { primary: "#0055A4", secondary: "#FFFFFF" },
} as Team;

function fixture(): CascadedKnockout {
  return {
    id: "f_01",
    stage: "f",
    match_no: 104,
    home: {
      source: { kind: "knockout_winner", match_id: "sf_01" },
      team: "ARG",
      from_actual: false,
    },
    away: {
      source: { kind: "knockout_winner", match_id: "sf_02" },
      team: "FRA",
      from_actual: false,
    },
    predicted_winner: null,
    actual_winner: null,
    effective_winner: null,
    affected_by_withdrawal: false,
  } as CascadedKnockout;
}

function teamMap(): ReadonlyMap<string, Team> {
  return new Map([
    ["ARG", ARG],
    ["FRA", FRA],
  ]);
}

describe("KnockoutMatch, flag-as-background", () => {
  // Updated contract (post-feedback): both sides render the team flag
  // as their background. The selected side is brighter + has a yellow
  // ring; the unselected side is dimmer (CSS-driven via :not(.is-winner)).
  it("renders backgroundImage on both sides when teams are known, even with no pick", () => {
    const { container } = render(
      <KnockoutMatch
        knockout={fixture()}
        teams={teamMap()}
        onChange={() => {}}
        showOddsChip={false}
      />,
    );
    const home = container.querySelector(".km-home") as HTMLButtonElement;
    const away = container.querySelector(".km-away") as HTMLButtonElement;
    expect(home.style.backgroundImage).toContain("/flags/ARG.svg");
    expect(away.style.backgroundImage).toContain("/flags/FRA.svg");
    // Neither is a winner pre-pick.
    expect(home.classList.contains("is-winner")).toBe(false);
    expect(away.classList.contains("is-winner")).toBe(false);
  });

  it("renders backgroundImage on both sides; home is winner when home is picked", () => {
    const prediction: MatchPrediction = {
      matchId: "f_01",
      outcome: "home_win",
      lockedAt: "2026-05-11T00:00:00Z",
    };
    const { container } = render(
      <KnockoutMatch
        knockout={fixture()}
        teams={teamMap()}
        prediction={prediction}
        onChange={() => {}}
        showOddsChip={false}
      />,
    );
    const home = container.querySelector(".km-home") as HTMLButtonElement;
    const away = container.querySelector(".km-away") as HTMLButtonElement;
    expect(home.style.backgroundImage).toContain("/flags/ARG.svg");
    expect(away.style.backgroundImage).toContain("/flags/FRA.svg");
    expect(home.classList.contains("is-winner")).toBe(true);
    expect(away.classList.contains("is-winner")).toBe(false);
  });

  it("renders backgroundImage on both sides; away is winner when away is picked", () => {
    const prediction: MatchPrediction = {
      matchId: "f_01",
      outcome: "away_win",
      lockedAt: "2026-05-11T00:00:00Z",
    };
    const { container } = render(
      <KnockoutMatch
        knockout={fixture()}
        teams={teamMap()}
        prediction={prediction}
        onChange={() => {}}
        showOddsChip={false}
      />,
    );
    const home = container.querySelector(".km-home") as HTMLButtonElement;
    const away = container.querySelector(".km-away") as HTMLButtonElement;
    expect(home.style.backgroundImage).toContain("/flags/ARG.svg");
    expect(away.style.backgroundImage).toContain("/flags/FRA.svg");
    expect(home.classList.contains("is-winner")).toBe(false);
    expect(away.classList.contains("is-winner")).toBe(true);
  });

  it("does not set the hover-preview CSS variable (replaced by always-on flag bg)", () => {
    const prediction: MatchPrediction = {
      matchId: "f_01",
      outcome: "home_win",
      lockedAt: "2026-05-11T00:00:00Z",
    };
    const { container } = render(
      <KnockoutMatch
        knockout={fixture()}
        teams={teamMap()}
        prediction={prediction}
        onChange={() => {}}
        showOddsChip={false}
      />,
    );
    const home = container.querySelector(".km-home") as HTMLButtonElement;
    const away = container.querySelector(".km-away") as HTMLButtonElement;
    expect(home.style.getPropertyValue("--km-flag-preview")).toBe("");
    expect(away.style.getPropertyValue("--km-flag-preview")).toBe("");
  });
});

describe("KnockoutMatch, bigger inline flags", () => {
  it("renders the inline TeamFlag chip at md (48px) by default, not sm (24px)", () => {
    const { container } = render(
      <KnockoutMatch
        knockout={fixture()}
        teams={teamMap()}
        onChange={() => {}}
        showOddsChip={false}
      />,
    );
    // TeamFlag in rect mode sets explicit width on the wrapper. md = 48.
    const flagWraps = container.querySelectorAll("[aria-label='Argentina']");
    // First one is the team-flag chip wrapper; on a knockout cell there
    // is exactly one Argentina flag (no other ARG references in this
    // fixture).
    const wrap = flagWraps[0] as HTMLElement | undefined;
    expect(wrap).toBeTruthy();
    expect(wrap!.style.width).toBe("48px");
    expect(wrap!.style.height).toBe("32px");
  });
});

describe("KnockoutMatch, a11y + interactions", () => {
  it("aria-pressed flips when the user picks the home side", () => {
    const onChange = vi.fn();
    const { container } = render(
      <KnockoutMatch
        knockout={fixture()}
        teams={teamMap()}
        onChange={onChange}
        showOddsChip={false}
      />,
    );
    const home = container.querySelector(".km-home") as HTMLButtonElement;
    expect(home.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(home);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: "f_01",
        outcome: "home_win",
      }),
    );
  });

  it("buttons are disabled and aria-pressed is false when slots are TBD", () => {
    const tbd: CascadedKnockout = {
      ...fixture(),
      home: {
        source: { kind: "knockout_winner", match_id: "sf_01" },
        team: null,
        from_actual: false,
      },
      away: {
        source: { kind: "knockout_winner", match_id: "sf_02" },
        team: null,
        from_actual: false,
      },
    } as CascadedKnockout;
    const { container } = render(
      <KnockoutMatch
        knockout={tbd}
        teams={teamMap()}
        onChange={() => {}}
        showOddsChip={false}
      />,
    );
    const home = container.querySelector(".km-home") as HTMLButtonElement;
    const away = container.querySelector(".km-away") as HTMLButtonElement;
    expect(home.disabled).toBe(true);
    expect(away.disabled).toBe(true);
    expect(home.getAttribute("aria-pressed")).toBe("false");
    expect(away.getAttribute("aria-pressed")).toBe("false");
  });

  it("aria-label is descriptive and references the team + match number", () => {
    const { container } = render(
      <KnockoutMatch
        knockout={fixture()}
        teams={teamMap()}
        onChange={() => {}}
        showOddsChip={false}
      />,
    );
    const home = container.querySelector(".km-home") as HTMLButtonElement;
    const away = container.querySelector(".km-away") as HTMLButtonElement;
    expect(home.getAttribute("aria-label")).toContain("Argentina");
    expect(home.getAttribute("aria-label")).toContain("F #104");
    expect(away.getAttribute("aria-label")).toContain("France");
  });

  it("aria-label reflects the picked state", () => {
    const prediction: MatchPrediction = {
      matchId: "f_01",
      outcome: "home_win",
      lockedAt: "2026-05-11T00:00:00Z",
    };
    const { container } = render(
      <KnockoutMatch
        knockout={fixture()}
        teams={teamMap()}
        prediction={prediction}
        onChange={() => {}}
        showOddsChip={false}
      />,
    );
    const home = container.querySelector(".km-home") as HTMLButtonElement;
    const away = container.querySelector(".km-away") as HTMLButtonElement;
    expect(home.getAttribute("aria-label")).toContain("currently picked");
    expect(away.getAttribute("aria-label")).toContain("pick to advance");
  });
});

describe("KnockoutMatch, layout improvements", () => {
  it("renders a smaller match-number chip in the header (no separate stage span)", () => {
    const { container } = render(
      <KnockoutMatch
        knockout={fixture()}
        teams={teamMap()}
        onChange={() => {}}
        showOddsChip={false}
      />,
    );
    const header = container.querySelector(".km-card-header") as HTMLElement;
    // We collapsed `<span class="km-stage">F</span>` + `<span class="km-no">#104</span>`
    // into a single `.km-no` chip showing "F #104".
    expect(container.querySelector(".km-stage")).toBeNull();
    const no = header.querySelector(".km-no") as HTMLElement;
    expect(no.textContent).toContain("F");
    expect(no.textContent).toContain("#104");
  });

  it("renders a thin connector instead of the 'vs' word", () => {
    const { container } = render(
      <KnockoutMatch
        knockout={fixture()}
        teams={teamMap()}
        onChange={() => {}}
        showOddsChip={false}
      />,
    );
    expect(container.querySelector(".km-connector")).not.toBeNull();
    expect(container.querySelector(".km-vs")).toBeNull();
  });

  it("renders the View-match link with arrow icon and label", () => {
    const { container } = render(
      <KnockoutMatch
        knockout={fixture()}
        teams={teamMap()}
        onChange={() => {}}
        showOddsChip={false}
      />,
    );
    const link = container.querySelector("a.km-view-link") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("/match/f_01/preview");
    expect(link.querySelector(".km-view-link-label")).not.toBeNull();
  });
});
