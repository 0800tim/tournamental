/**
 * Integration test — odds chip appears next to every match prediction
 * row + knockout match in the bracket page, the chip's hover card opens
 * with three rows summing to 100%, and the chip stays a sibling of the
 * existing match-row buttons (so we haven't broken keyboard a11y).
 */

// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

import { loadFixtures2026 } from "@vtorn/bracket-engine";

import { BracketBuilder } from "../components/bracket/BracketBuilder";
import type { MatchOdds } from "../lib/odds/types";

const tournament = loadFixtures2026();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  // Stub fetch — answer /api/odds/match/* with deterministic odds, and
  // /api/odds/team/*/group with a 0.25 baseline so each of the four
  // teams in a group gets ~25% group-winner.
  vi.spyOn(global, "fetch").mockImplementation(((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/odds/country")) {
      return Promise.resolve(jsonResponse({ country: "US" }));
    }
    if (url.includes("/api/odds/snapshot")) {
      // Bulk snapshot — BracketBuilder fetches once on mount and
      // distributes via the oddsByMatch Map.
      const matches: MatchOdds[] = tournament.group_fixtures.map((f) => ({
        matchNo: String(f.match_no),
        homeTeam: "MEX",
        awayTeam: "RSA",
        homeWin: 0.5,
        draw: 0.3,
        awayWin: 0.2,
        source: "polymarket",
        updatedAt: new Date().toISOString(),
      }));
      return Promise.resolve(
        jsonResponse({ matches, source: "polymarket", updatedAt: new Date().toISOString() }),
      );
    }
    if (url.includes("/api/odds/match/")) {
      // Extract matchNo from URL.
      const match = url.match(/\/api\/odds\/match\/([^/?]+)/);
      const matchNo = match?.[1] ?? "0";
      const data: MatchOdds = {
        matchNo,
        homeTeam: "MEX",
        awayTeam: "RSA",
        homeWin: 0.50,
        draw: 0.30,
        awayWin: 0.20,
        source: "polymarket",
        updatedAt: new Date().toISOString(),
      };
      return Promise.resolve(jsonResponse(data));
    }
    if (url.includes("/api/odds/team/") && url.includes("/group")) {
      // Per-team mock for GroupWinnerChips — echo the queried team
      // code so each team in a group gets a unique entry.
      const m = url.match(/\/api\/odds\/team\/([^/?]+)\/group/);
      const teamCode = m?.[1] ?? "UNK";
      return Promise.resolve(
        jsonResponse({
          teamCode,
          groupId: "A",
          groupWinnerProb: 0.25,
          source: "mock-fifa-rank",
          updatedAt: new Date().toISOString(),
        }),
      );
    }
    return Promise.resolve(jsonResponse({ ok: true }));
  }) as typeof fetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Bracket page — match-row inline odds integration", () => {
  it("renders three inline W/D/L percentages under each group match row", async () => {
    const { container } = render(<BracketBuilder tournament={tournament} />);

    // Wait for the bulk snapshot to land and the rows to fill in their
    // inline percentages (the home pct cell goes from "—" to "50%").
    await waitFor(() => {
      const homePct = container.querySelector(
        '.mpr-pick-home .mpr-pick-pct',
      ) as HTMLElement | null;
      if (!homePct) throw new Error("no home pct cell");
      if (homePct.textContent?.includes("—")) throw new Error("still loading");
      return true;
    });

    // 12 groups × 6 fixtures = 72 group-stage rows; each has three pct cells.
    const homePcts = container.querySelectorAll(".mpr-pick-home .mpr-pick-pct");
    const drawPcts = container.querySelectorAll(".mpr-pick-draw .mpr-pick-pct");
    const awayPcts = container.querySelectorAll(".mpr-pick-away .mpr-pick-pct");
    expect(homePcts.length).toBe(72);
    expect(drawPcts.length).toBe(72);
    expect(awayPcts.length).toBe(72);
    expect(homePcts[0]?.textContent).toMatch(/50%/);
    expect(drawPcts[0]?.textContent).toMatch(/30%/);
    expect(awayPcts[0]?.textContent).toMatch(/20%/);
  });

  it("does not render the legacy in-row OddsChip block", async () => {
    const { container } = render(<BracketBuilder tournament={tournament} />);
    await waitFor(() => {
      const homePct = container.querySelector(
        '.mpr-pick-home .mpr-pick-pct',
      ) as HTMLElement | null;
      if (!homePct || homePct.textContent?.includes("—")) {
        throw new Error("still loading");
      }
      return true;
    });
    // The duplicate per-row OddsChip wrapper is gone — odds are inline
    // under each pick now.
    expect(container.querySelector("[data-mpr-odds]")).toBeNull();
    expect(container.querySelector(".mpr-odds-cta")).toBeNull();
  });

  it("clicking a flag pick toggles aria-pressed on the row", async () => {
    const { container } = render(<BracketBuilder tournament={tournament} />);
    await waitFor(() => {
      expect(container.querySelector(".mpr-row")).not.toBeNull();
    });

    const firstRow = container.querySelector(".mpr-row") as HTMLElement;
    const homeBtn = firstRow.querySelector(".mpr-pick-home") as HTMLButtonElement;
    const drawBtn = firstRow.querySelector(".mpr-pick-draw") as HTMLButtonElement;
    const awayBtn = firstRow.querySelector(".mpr-pick-away") as HTMLButtonElement;
    expect(homeBtn).not.toBeNull();
    expect(drawBtn).not.toBeNull();
    expect(awayBtn).not.toBeNull();
    fireEvent.click(homeBtn);
    expect(homeBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("group-winner chip bar renders four chips per group", async () => {
    const { container } = render(<BracketBuilder tournament={tournament} />);
    await waitFor(() => {
      const groups = container.querySelectorAll(".bracket-group-winner-chips");
      expect(groups.length).toBeGreaterThan(0);
    });
    // Wait for the chips to populate.
    await waitFor(() => {
      const firstGroupBar = container.querySelector(".bracket-group-winner-chips") as HTMLElement;
      const chips = firstGroupBar.querySelectorAll('[role="button"]');
      expect(chips.length).toBe(4);
    });
  });
});
