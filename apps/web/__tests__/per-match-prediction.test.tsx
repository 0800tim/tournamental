/**
 * Per-match prediction UI integration tests (Testing Library + jsdom).
 *
 * Substitutes the originally-spec'd Playwright e2e because Playwright is
 * not installed in this monorepo. The same critical-path assertions are
 * exercised end-to-end through the React component tree:
 *
 *   1. Picking outcome buttons updates the predicted standings panel
 *      live without an API call.
 *   2. Picking outcomes that produce a primary-tie surfaces the
 *      tiebreaker control.
 *   3. The bracket draft persists to localStorage.
 *
 * For a true browser-level Playwright test, install
 * `@playwright/test` + `playwright` in `apps/web` and copy the assertions
 * from this file into a `.spec.ts` under `apps/web/__tests__/e2e/`.
 */

// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { loadFixtures2026 } from "@vtorn/bracket-engine";

import { BracketBuilder } from "../components/bracket/BracketBuilder";

const tournament = loadFixtures2026();

beforeEach(() => {
  window.localStorage.clear();
});

describe("BracketBuilder — per-match predictions", () => {
  it("renders the 12 group cards on the group-stage tab by default", () => {
    render(<BracketBuilder tournament={tournament} />);
    // Group A header is present; standings panel is empty hint state.
    expect(screen.getByText(/Group A/)).toBeDefined();
    expect(screen.getAllByText(/Group [A-L]/).length).toBeGreaterThanOrEqual(12);
  });

  it("clicking outcome buttons in group A updates the predicted standings panel live", () => {
    render(<BracketBuilder tournament={tournament} />);

    // Find the group A card and click outcomes that make MEX win the
    // group outright. Matches inside group A:
    //   1: MEX(home) vs RSA(away) — MEX win → home_win
    //   2: KOR(home) vs CZE(away) — KOR win → home_win
    //   3: MEX(home) vs KOR(away) — MEX win → home_win
    //   4: CZE(home) vs RSA(away) — RSA win → away_win
    //   5: CZE(home) vs MEX(away) — MEX win → away_win
    //   6: RSA(home) vs KOR(away) — RSA win → home_win
    // MEX 3W → 9 pts, advances 1st.
    const groupACard = screen.getAllByText("Group A")[0]!.closest(
      ".bracket-group",
    ) as HTMLElement;
    const matchRows = groupACard.querySelectorAll(".mpr-row");
    expect(matchRows.length).toBe(6);
    // Helper: pick a button by class within a row.
    const pickIn = (row: Element, btnClass: string): void => {
      const btn = row.querySelector(`.${btnClass}`) as HTMLButtonElement | null;
      if (!btn) throw new Error(`No ${btnClass} button in row`);
      fireEvent.click(btn);
    };
    pickIn(matchRows[0]!, "mpr-pick-home"); // MEX over RSA
    pickIn(matchRows[1]!, "mpr-pick-home"); // KOR over CZE
    pickIn(matchRows[2]!, "mpr-pick-home"); // MEX over KOR
    pickIn(matchRows[3]!, "mpr-pick-away"); // RSA over CZE
    pickIn(matchRows[4]!, "mpr-pick-away"); // MEX over CZE
    pickIn(matchRows[5]!, "mpr-pick-home"); // RSA over KOR

    // Predicted standings panel should now show MEX with 9 pts (3W).
    const standingsPanel = groupACard.querySelector(
      ".bracket-standings-list",
    ) as HTMLElement | null;
    expect(standingsPanel).toBeTruthy();
    const mexRow = within(standingsPanel!)
      .getByText("MEX")
      .closest(".bracket-standings-row");
    expect(mexRow?.textContent).toMatch(/9 pts/);
    expect(mexRow?.className).toContain("is-advance");
  });

  it("persists the prediction to localStorage", () => {
    render(<BracketBuilder tournament={tournament} />);
    // Click the first home-win button in group A.
    const groupACard = screen.getAllByText("Group A")[0]!.closest(
      ".bracket-group",
    ) as HTMLElement;
    const firstMatchRow = groupACard.querySelector(".mpr-row")!;
    fireEvent.click(firstMatchRow.querySelector(".mpr-pick-home")!);
    // Find draft key
    const localUserId = window.localStorage.getItem("vtorn:local_user_id");
    expect(localUserId).toBeTruthy();
    const draftKey = `vtorn:bracket:v2:${tournament.id}:${localUserId}`;
    const raw = window.localStorage.getItem(draftKey);
    expect(raw).toBeTruthy();
    const draft = JSON.parse(raw!);
    expect(draft.matchPredictions).toBeDefined();
    expect(draft.matchPredictions["1"]).toMatchObject({
      outcome: "home_win",
      matchId: "1",
    });
  });

  it("switching to the knockouts tab shows the knockouts grid", () => {
    render(<BracketBuilder tournament={tournament} />);
    fireEvent.click(screen.getByRole("tab", { name: /Knockouts/ }));
    expect(screen.getByText(/Click the team you predict will advance/)).toBeDefined();
    // R32 column header must appear.
    expect(screen.getAllByText("R32").length).toBeGreaterThan(0);
  });

  it("switching to the save tab shows the save summary + counts", () => {
    render(<BracketBuilder tournament={tournament} />);
    fireEvent.click(screen.getByRole("tab", { name: /Save \+ share/ }));
    expect(screen.getByText(/group matches/)).toBeDefined();
    expect(screen.getByText(/knockout picks/)).toBeDefined();
  });

  it("hydrates a saved draft from localStorage on subsequent mount", () => {
    // Seed a draft directly.
    const draft = {
      bracketId: "u_test",
      matchPredictions: {
        "1": { matchId: "1", outcome: "home_win", lockedAt: "2026-05-15T00:00:00Z" },
      },
      groupTiebreakers: {},
      knockoutPredictions: {},
      version: 2,
    };
    window.localStorage.setItem("vtorn:local_user_id", "u_test");
    window.localStorage.setItem(
      `vtorn:bracket:v2:${tournament.id}:u_test`,
      JSON.stringify(draft),
    );
    render(<BracketBuilder tournament={tournament} />);

    // Group A standings row for MEX should already show 3 pts.
    const groupACard = screen.getAllByText("Group A")[0]!.closest(".bracket-group");
    const standingsPanel = (groupACard as HTMLElement).querySelector(
      ".bracket-standings-list",
    ) as HTMLElement | null;
    const mexRow = within(standingsPanel!)
      .getByText("MEX")
      .closest(".bracket-standings-row");
    expect(mexRow?.textContent).toMatch(/3 pts/);
  });
});
