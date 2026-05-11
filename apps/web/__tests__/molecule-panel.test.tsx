/**
 * Vitest, `<MoleculePanel>` group-stage section render test.
 *
 * The panel is plain DOM (no R3F) so it mounts cleanly under jsdom.
 * We feed it a synthetic Bracket where MEX tops Group A and verify the
 * GROUP STAGE section renders the right header, summary sentence, and
 * per-match rows.
 */

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { MoleculePanel } from "@/components/molecule/MoleculePanel";
import { loadFixtures2026, type Bracket, type MatchPrediction } from "@tournamental/bracket-engine";

const T = loadFixtures2026();

function pred(
  matchId: string,
  outcome: "home_win" | "draw" | "away_win",
  homeScore?: number,
  awayScore?: number,
): MatchPrediction {
  return {
    matchId,
    outcome,
    homeScore,
    awayScore,
    lockedAt: "2026-06-11T00:00:00Z",
  };
}

const BRACKET_MEX_TOPS_A: Bracket = {
  bracketId: "test",
  matchPredictions: {
    "1": pred("1", "home_win", 2, 0), // MEX vs RSA → MEX
    "3": pred("3", "home_win", 3, 1), // MEX vs KOR → MEX
    "5": pred("5", "away_win", 0, 1), // CZE vs MEX → MEX
  },
  groupTiebreakers: {},
  knockoutPredictions: {},
  version: 2,
};

describe("<MoleculePanel>, group-stage section", () => {
  it("renders the Group stage header when a team is selected", () => {
    render(
      <MoleculePanel
        teamCode="MEX"
        tournament={T}
        bracket={BRACKET_MEX_TOPS_A}
        cascaded={null}
        finalStageByTeam={new Map([["MEX", "group"]])}
        flagEmojiByTeam={new Map([["MEX", "🇲🇽"]])}
        onClose={() => {}}
      />,
    );
    const heading = screen.getByRole("heading", { level: 3, name: /group stage/i });
    expect(heading).toBeDefined();
  });

  it("shows the 1ST rank pill when the team tops their group", () => {
    render(
      <MoleculePanel
        teamCode="MEX"
        tournament={T}
        bracket={BRACKET_MEX_TOPS_A}
        cascaded={null}
        finalStageByTeam={new Map([["MEX", "group"]])}
        flagEmojiByTeam={new Map([["MEX", "🇲🇽"]])}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("1ST")).toBeDefined();
  });

  it("renders Tim's summary-line copy: 'Topped Group A with 9 points (+5 GD).'", () => {
    render(
      <MoleculePanel
        teamCode="MEX"
        tournament={T}
        bracket={BRACKET_MEX_TOPS_A}
        cascaded={null}
        finalStageByTeam={new Map([["MEX", "group"]])}
        flagEmojiByTeam={new Map([["MEX", "🇲🇽"]])}
        onClose={() => {}}
      />,
    );
    const summary = screen.getByText(/topped group a with 9 points/i);
    expect(summary).toBeDefined();
    expect(summary.textContent).toContain("+5 GD");
  });

  it("renders three group-match rows with opponent codes", () => {
    const { container } = render(
      <MoleculePanel
        teamCode="MEX"
        tournament={T}
        bracket={BRACKET_MEX_TOPS_A}
        cascaded={null}
        finalStageByTeam={new Map([["MEX", "group"]])}
        flagEmojiByTeam={new Map([["MEX", "🇲🇽"]])}
        onClose={() => {}}
      />,
    );
    const rows = container.querySelectorAll(".molecule-panel-group-match");
    expect(rows.length).toBe(3);
    // Each row should mention one of the three opponents.
    const rowText = Array.from(rows).map((r) => r.textContent ?? "").join("\n");
    expect(rowText).toContain("RSA");
    expect(rowText).toContain("KOR");
    expect(rowText).toContain("CZE");
  });

  it("shows the Knockout empty-state when no knockout matches are predicted", () => {
    render(
      <MoleculePanel
        teamCode="MEX"
        tournament={T}
        bracket={BRACKET_MEX_TOPS_A}
        cascaded={null}
        finalStageByTeam={new Map([["MEX", "group"]])}
        flagEmojiByTeam={new Map([["MEX", "🇲🇽"]])}
        onClose={() => {}}
      />,
    );
    const koSection = screen.getByRole("heading", { level: 3, name: /knockout/i })
      .parentElement!.parentElement!;
    expect(within(koSection).getByText(/eliminated at the group stage/i)).toBeDefined();
  });

  it("renders the team's terminal-state pill in the header", () => {
    render(
      <MoleculePanel
        teamCode="MEX"
        tournament={T}
        bracket={BRACKET_MEX_TOPS_A}
        cascaded={null}
        finalStageByTeam={new Map([["MEX", "group"]])}
        flagEmojiByTeam={new Map([["MEX", "🇲🇽"]])}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("OUT IN GROUP")).toBeDefined();
  });

  it("returns null when no team is selected", () => {
    const { container } = render(
      <MoleculePanel
        teamCode={null}
        tournament={T}
        bracket={BRACKET_MEX_TOPS_A}
        cascaded={null}
        finalStageByTeam={new Map()}
        flagEmojiByTeam={new Map()}
        onClose={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
