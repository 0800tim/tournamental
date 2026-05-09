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

describe("Bracket page — odds chip integration", () => {
  it("renders an odds chip next to every group match row", async () => {
    const { container } = render(<BracketBuilder tournament={tournament} />);

    // Wait for at least one chip to resolve.
    await waitFor(() => {
      const chips = container.querySelectorAll('[data-mpr-odds] [role="button"]');
      expect(chips.length).toBeGreaterThan(0);
    });
    // Each group has 6 matches × 12 groups = 72 group-stage chips.
    const chips = container.querySelectorAll('[data-mpr-odds] [role="button"]');
    expect(chips.length).toBe(72);
  });

  it("hover-card opens on Enter and shows three rows (Home, Draw, Away)", async () => {
    const { container } = render(<BracketBuilder tournament={tournament} />);

    // Wait for the chip to leave the loading state — only then is the
    // hover-card rendered into the tree.
    const firstChip = await waitFor(() => {
      const c = container.querySelector('[data-mpr-odds] [role="button"]') as HTMLElement | null;
      if (!c) throw new Error("no chip");
      if (c.getAttribute("data-state") !== "ok") throw new Error("loading");
      return c;
    });

    fireEvent.keyDown(firstChip, { key: "Enter" });

    await waitFor(() => {
      expect(firstChip.getAttribute("aria-expanded")).toBe("true");
    });

    // The popover sibling is now data-open="true".
    const tooltip = await waitFor(() => {
      const t = container.querySelector('[role="tooltip"][data-open="true"]') as HTMLElement | null;
      if (!t) throw new Error("no tooltip yet");
      return t;
    });

    // Three .cardRow elements (home, draw, away) sum to 100%.
    const rows = tooltip.querySelectorAll('[data-side="home"], [data-side="draw"], [data-side="away"]');
    expect(rows.length).toBe(3);
    const pcts = Array.from(rows).map((r) => {
      const m = r.textContent?.match(/(\d+)%/);
      return m ? Number(m[1]) : 0;
    });
    const total = pcts.reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });

  it("chip co-exists with the existing match-row buttons (no a11y regression)", async () => {
    const { container } = render(<BracketBuilder tournament={tournament} />);
    await waitFor(() => {
      expect(container.querySelectorAll('[data-mpr-odds] [role="button"]').length).toBeGreaterThan(0);
    });

    const firstRow = container.querySelector(".mpr-row") as HTMLElement;
    expect(firstRow).not.toBeNull();
    // Original outcome buttons still present — Home Win / Draw / Away Win.
    // Find them by their CSS class (set by MatchPredictionRow) so we
    // don't tangle with the chip's `role="button"` sibling.
    const homeBtn = firstRow.querySelector(".mpr-pick-home") as HTMLButtonElement;
    const drawBtn = firstRow.querySelector(".mpr-pick-draw") as HTMLButtonElement;
    const awayBtn = firstRow.querySelector(".mpr-pick-away") as HTMLButtonElement;
    expect(homeBtn).not.toBeNull();
    expect(drawBtn).not.toBeNull();
    expect(awayBtn).not.toBeNull();
    // Existing click behaviour still works.
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
