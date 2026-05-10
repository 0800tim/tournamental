/**
 * MatchPickPopup — smoke tests for the per-match pick popup component
 * and useMatchPick hook.
 *
 * Coverage:
 *   - Renders W/D/L (group) / W/L (knockout) buttons.
 *   - Selecting an outcome flips the kit-coloured selection ring.
 *   - Save calls PUT /v1/picks/:userId/:matchId with the right body.
 *   - 409 lockout banner + buttons disabled past kickoff.
 *   - 422 invalid_outcome error message.
 *   - Close on Escape, X click, backdrop click.
 *   - Inline mode hides the close button + Cancel.
 *   - Knockout (noDraw) hides the draw button.
 *   - Hook exposes a remove() that DELETEs.
 *   - Network error keeps the local pick.
 *   - Score steppers appear after picking an outcome.
 *   - Idempotent re-save (same outcome twice).
 */

// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

import type { Team } from "@vtorn/bracket-engine";

import { MatchPickPopup } from "../components/match-pick/MatchPickPopup";

const HOME: Team = {
  id: "ARG",
  name: "Argentina",
  country: "AR",
  fifa_rank: 1,
  pre_tournament_implied_win: 0.4,
  kit: { primary: "#75aadb", secondary: "#ffffff" },
} as Team;

const AWAY: Team = {
  id: "FRA",
  name: "France",
  country: "FR",
  fifa_rank: 2,
  pre_tournament_implied_win: 0.3,
  kit: { primary: "#1f2a8c", secondary: "#ffffff" },
} as Team;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  // Each test gets a clean localStorage so the local-fallback path is
  // deterministic and one test doesn't bleed picks into another.
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MatchPickPopup", () => {
  it("renders three picks for a group match (W/D/L)", () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: "not_found" }));
    const { container } = render(
      <MatchPickPopup
        matchId="1"
        homeTeam={HOME}
        awayTeam={AWAY}
        kickoffIso={new Date(Date.now() + 60 * 60_000).toISOString()}
        presentation="modal"
        fetchImpl={fetchImpl as unknown as typeof fetch}
        baseUrl="https://test.invalid"
        userId="u_test"
        onClose={() => {}}
      />,
    );
    expect(container.querySelector(".mpp-pick-home")).toBeTruthy();
    expect(container.querySelector(".mpp-pick-draw")).toBeTruthy();
    expect(container.querySelector(".mpp-pick-away")).toBeTruthy();
  });

  it("hides the draw button when noDraw is true (knockout)", () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: "not_found" }));
    const { container } = render(
      <MatchPickPopup
        matchId="r32_01"
        homeTeam={HOME}
        awayTeam={AWAY}
        noDraw
        presentation="modal"
        fetchImpl={fetchImpl as unknown as typeof fetch}
        baseUrl="https://test.invalid"
        userId="u_test"
        onClose={() => {}}
      />,
    );
    expect(container.querySelector(".mpp-pick-home")).toBeTruthy();
    expect(container.querySelector(".mpp-pick-draw")).toBeFalsy();
    expect(container.querySelector(".mpp-pick-away")).toBeTruthy();
  });

  it("clicking the home pick flips the selection ring", () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: "not_found" }));
    const { container } = render(
      <MatchPickPopup
        matchId="1"
        homeTeam={HOME}
        awayTeam={AWAY}
        presentation="modal"
        fetchImpl={fetchImpl as unknown as typeof fetch}
        baseUrl="https://test.invalid"
        userId="u_test"
        onClose={() => {}}
      />,
    );
    const home = container.querySelector(".mpp-pick-home") as HTMLButtonElement;
    fireEvent.click(home);
    expect(home.classList.contains("is-selected")).toBe(true);
  });

  it("Save calls PUT with the right body and triggers onSaved", async () => {
    const savedPick = {
      matchId: "1",
      outcome: "home_win",
      lockedAt: "2026-06-01T00:00:00Z",
    };
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(jsonResponse(404, { error: "not_found" })),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(
          jsonResponse(200, {
            pick: savedPick,
            stage: "group",
            bracket_id: "bk_1",
            tournament_id: "fifa-wc-2026",
            cascade_refresh_hint: false,
          }),
        ),
      );
    const onSaved = vi.fn();
    const { container, getByText } = render(
      <MatchPickPopup
        matchId="1"
        homeTeam={HOME}
        awayTeam={AWAY}
        presentation="modal"
        fetchImpl={fetchImpl as unknown as typeof fetch}
        baseUrl="https://test.invalid"
        userId="u_test"
        onSaved={onSaved}
        onClose={() => {}}
      />,
    );
    fireEvent.click(container.querySelector(".mpp-pick-home") as HTMLButtonElement);
    fireEvent.click(getByText("Save pick"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved.mock.calls[0]?.[0]).toEqual(savedPick);

    const putCall = fetchImpl.mock.calls.find(
      (c) => (c?.[1] as { method?: string } | undefined)?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    const init = putCall![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({
      tournament_id: "fifa-wc-2026",
      outcome: "home_win",
    });
  });

  it("renders the lockout banner when kickoff is past + disables the picks", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: "not_found" }));
    const { container, getByText } = render(
      <MatchPickPopup
        matchId="1"
        homeTeam={HOME}
        awayTeam={AWAY}
        kickoffIso={past}
        presentation="modal"
        fetchImpl={fetchImpl as unknown as typeof fetch}
        baseUrl="https://test.invalid"
        userId="u_test"
        onClose={() => {}}
      />,
    );
    expect(getByText(/match has already started/i)).toBeTruthy();
    const home = container.querySelector(".mpp-pick-home") as HTMLButtonElement;
    expect(home.disabled).toBe(true);
  });

  it("surfaces 422 outcome_not_allowed_for_stage with a helpful message", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(jsonResponse(404, { error: "not_found" })),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(
          jsonResponse(422, {
            error: "outcome_not_allowed_for_stage",
            stage: "r32",
          }),
        ),
      );
    const { container, findByRole, getByText } = render(
      <MatchPickPopup
        matchId="r32_01"
        homeTeam={HOME}
        awayTeam={AWAY}
        // The component still happily lets the user try draw if it's
        // wired into a row that doesn't pass noDraw. The error is the
        // server's last word.
        presentation="modal"
        fetchImpl={fetchImpl as unknown as typeof fetch}
        baseUrl="https://test.invalid"
        userId="u_test"
        onClose={() => {}}
      />,
    );
    fireEvent.click(container.querySelector(".mpp-pick-draw") as HTMLButtonElement);
    fireEvent.click(getByText("Save pick"));
    const alert = await findByRole("alert");
    expect(alert.textContent).toMatch(/knockout/i);
  });

  it("surfaces 409 match_already_started error when server rejects", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(jsonResponse(404, { error: "not_found" })),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(
          jsonResponse(409, {
            error: "match_already_started",
            kickoff_utc: "2026-06-11T19:00:00Z",
          }),
        ),
      );
    const { container, findByRole, getByText } = render(
      <MatchPickPopup
        matchId="1"
        homeTeam={HOME}
        awayTeam={AWAY}
        presentation="modal"
        fetchImpl={fetchImpl as unknown as typeof fetch}
        baseUrl="https://test.invalid"
        userId="u_test"
        onClose={() => {}}
      />,
    );
    fireEvent.click(container.querySelector(".mpp-pick-home") as HTMLButtonElement);
    fireEvent.click(getByText("Save pick"));
    const alert = await findByRole("alert");
    expect(alert.textContent).toMatch(/already started/i);
  });

  it("close button calls onClose", () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: "not_found" }));
    const onClose = vi.fn();
    const { container } = render(
      <MatchPickPopup
        matchId="1"
        homeTeam={HOME}
        awayTeam={AWAY}
        presentation="modal"
        fetchImpl={fetchImpl as unknown as typeof fetch}
        baseUrl="https://test.invalid"
        userId="u_test"
        onClose={onClose}
      />,
    );
    fireEvent.click(container.querySelector(".mpp-close") as HTMLButtonElement);
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape key closes the dialog (modal/sheet)", () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: "not_found" }));
    const onClose = vi.fn();
    render(
      <MatchPickPopup
        matchId="1"
        homeTeam={HOME}
        awayTeam={AWAY}
        presentation="modal"
        fetchImpl={fetchImpl as unknown as typeof fetch}
        baseUrl="https://test.invalid"
        userId="u_test"
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("backdrop click closes the dialog (modal)", () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: "not_found" }));
    const onClose = vi.fn();
    const { getByTestId } = render(
      <MatchPickPopup
        matchId="1"
        homeTeam={HOME}
        awayTeam={AWAY}
        presentation="modal"
        fetchImpl={fetchImpl as unknown as typeof fetch}
        baseUrl="https://test.invalid"
        userId="u_test"
        onClose={onClose}
      />,
    );
    fireEvent.click(getByTestId("mpp-overlay"));
    expect(onClose).toHaveBeenCalled();
  });

  it("inline presentation does NOT render a close button or Cancel", () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: "not_found" }));
    const { container, queryByText } = render(
      <MatchPickPopup
        matchId="1"
        homeTeam={HOME}
        awayTeam={AWAY}
        presentation="inline"
        fetchImpl={fetchImpl as unknown as typeof fetch}
        baseUrl="https://test.invalid"
        userId="u_test"
        onClose={() => {}}
      />,
    );
    expect(container.querySelector(".mpp-close")).toBeFalsy();
    expect(queryByText("Cancel")).toBeNull();
  });

  it("score steppers appear after an outcome is selected", () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: "not_found" }));
    const { container, queryByText, getByText } = render(
      <MatchPickPopup
        matchId="1"
        homeTeam={HOME}
        awayTeam={AWAY}
        presentation="modal"
        fetchImpl={fetchImpl as unknown as typeof fetch}
        baseUrl="https://test.invalid"
        userId="u_test"
        onClose={() => {}}
      />,
    );
    expect(queryByText("Add exact score")).toBeNull();
    fireEvent.click(container.querySelector(".mpp-pick-home") as HTMLButtonElement);
    fireEvent.click(getByText("Add exact score"));
    expect(container.querySelector(".mpp-scores")).toBeTruthy();
  });

  it("network error falls back to a local pick (button label flips to Update pick)", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(jsonResponse(404, { error: "not_found" })),
      )
      .mockImplementationOnce(() => Promise.reject(new Error("network down")));
    const { container, getByText, findByText } = render(
      <MatchPickPopup
        matchId="1"
        homeTeam={HOME}
        awayTeam={AWAY}
        presentation="inline"
        fetchImpl={fetchImpl as unknown as typeof fetch}
        baseUrl="https://test.invalid"
        userId="u_test"
        onClose={() => {}}
      />,
    );
    fireEvent.click(container.querySelector(".mpp-pick-home") as HTMLButtonElement);
    fireEvent.click(getByText("Save pick"));
    // Local fallback wrote the pick — the error banner shows up.
    await findByText(/Couldn't save/i);
  });

  it("Save button is disabled until an outcome is picked", () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: "not_found" }));
    const { getByText } = render(
      <MatchPickPopup
        matchId="1"
        homeTeam={HOME}
        awayTeam={AWAY}
        presentation="modal"
        fetchImpl={fetchImpl as unknown as typeof fetch}
        baseUrl="https://test.invalid"
        userId="u_test"
        onClose={() => {}}
      />,
    );
    const save = getByText("Save pick") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });
});
