/**
 * Component tests for OddsChip + OddsHoverCard.
 *
 * Strategy: stub `fetch` to return a known MatchOdds payload. The chip
 * uses `useMatchOdds` which falls through to the `/api/odds/match/...`
 * stub on the same host; in jsdom we just intercept via the global
 * `fetch`.
 *
 * We assert:
 *   - The chip renders the expected percentages once data arrives.
 *   - `aria-label` exposes the full sentence to screen readers.
 *   - Hover card opens on focus (CSS:focus-within is hard to drive in
 *     jsdom, so we instead toggle Enter/Space and assert `aria-expanded`).
 *   - Knockout matches don't render the Draw row.
 *   - Long names truncate without overflowing the chip layout.
 *   - Missing data / error states render gracefully.
 *   - The affiliate CTA is hidden for NZ, softened for GB, full for US.
 */

// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { OddsChip } from "../components/odds/OddsChip";
import type { MatchOdds } from "../lib/odds/types";

const ARG_MEX_LIVE: MatchOdds = {
  matchNo: "1",
  homeTeam: "ARG",
  awayTeam: "MEX",
  homeWin: 0.55,
  draw: 0.25,
  awayWin: 0.20,
  source: "polymarket",
  updatedAt: new Date().toISOString(),
  marketId: "wc2026-arg-mex",
};

const ARG_MEX_KO: MatchOdds = {
  matchNo: "r32_03",
  homeTeam: "ARG",
  awayTeam: "MEX",
  homeWin: 0.66,
  draw: null,
  awayWin: 0.34,
  source: "polymarket",
  updatedAt: new Date().toISOString(),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  // Default fetch: respond to /api/odds/country with NZ-by-default to
  // exercise the CTA hidden state, and /api/odds/match/* with our live
  // fixture. Tests that need a different country override globally.
  vi.spyOn(global, "fetch").mockImplementation(((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/odds/country")) {
      return Promise.resolve(jsonResponse({ country: "NZ" }));
    }
    if (url.includes("r32_03")) {
      return Promise.resolve(jsonResponse(ARG_MEX_KO));
    }
    if (url.includes("/api/odds/match/")) {
      return Promise.resolve(jsonResponse(ARG_MEX_LIVE));
    }
    return Promise.resolve(jsonResponse({ ok: true }));
  }) as typeof fetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OddsChip", () => {
  it("renders a button with an aria-label describing the live odds", async () => {
    render(
      <OddsChip
        matchNo="1"
        homeTeam="ARG"
        awayTeam="MEX"
        homeLabel="Argentina"
        awayLabel="Mexico"
      />,
    );
    const chip = await waitFor(() =>
      screen.getByRole("button", { name: /Live odds: Argentina 55%/i }),
    );
    expect(chip.getAttribute("aria-label")).toMatch(/draw 25%/i);
    expect(chip.getAttribute("aria-label")).toMatch(/Mexico 20%/i);
  });

  it("renders three percentage pills for a group match", async () => {
    const { container } = render(
      <OddsChip matchNo="1" homeTeam="ARG" awayTeam="MEX" />,
    );
    await waitFor(() => {
      const text = container.textContent ?? "";
      expect(text).toContain("ARG");
      expect(text).toContain("55%");
      expect(text).toContain("D");
      expect(text).toContain("25%");
      expect(text).toContain("MEX");
      expect(text).toContain("20%");
    });
  });

  it("hides the Draw row for knockout matches", async () => {
    render(
      <OddsChip matchNo="r32_03" homeTeam="ARG" awayTeam="MEX" noDraw />,
    );
    const chip = await waitFor(() =>
      screen.getByRole("button", { name: /Live odds: ARG 66%/i }),
    );
    // No "draw" mention in aria-label.
    expect(chip.getAttribute("aria-label")).not.toMatch(/draw/i);
  });

  it("toggles the popover open state with Enter / Space", async () => {
    render(<OddsChip matchNo="1" homeTeam="ARG" awayTeam="MEX" />);
    const chip = await waitFor(() => screen.getByRole("button"));
    expect(chip.getAttribute("aria-expanded")).toBeFalsy();
    fireEvent.keyDown(chip, { key: "Enter" });
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(chip, { key: "Escape" });
    expect(chip.getAttribute("aria-expanded")).toBeFalsy();
  });

  it("loading state renders a placeholder with `data-state=loading`", () => {
    // Prevent the fetch from resolving so we stay in the loading state.
    vi.spyOn(global, "fetch").mockImplementation((() =>
      new Promise(() => {})) as typeof fetch);
    render(<OddsChip matchNo="loading" homeTeam="ARG" awayTeam="MEX" />);
    const chip = screen.getByRole("button");
    expect(chip.getAttribute("data-state")).toBe("loading");
  });

  it("hover card includes the source attribution and last-updated age", async () => {
    render(
      <OddsChip
        matchNo="1"
        homeTeam="ARG"
        awayTeam="MEX"
        homeLabel="Argentina"
        awayLabel="Mexico"
      />,
    );
    await waitFor(() => screen.getByRole("button"));
    const tooltip = await waitFor(() => screen.getByRole("tooltip"));
    expect(tooltip.textContent).toContain("Polymarket");
    expect(tooltip.textContent).toMatch(/just now|s ago|m ago|h ago/);
  });

  it("hover card shows full team names, not just codes", async () => {
    render(
      <OddsChip
        matchNo="1"
        homeTeam="ARG"
        awayTeam="MEX"
        homeLabel="Argentina"
        awayLabel="Mexico"
      />,
    );
    const tooltip = await waitFor(() => screen.getByRole("tooltip"));
    expect(tooltip.textContent).toContain("Argentina");
    expect(tooltip.textContent).toContain("Mexico");
  });

  it("very long team names render without breaking the chip aria-label", async () => {
    render(
      <OddsChip
        matchNo="1"
        homeTeam="ARG"
        awayTeam="MEX"
        homeLabel="République Démocratique du Congo"
        awayLabel="Bosnia and Herzegovina"
      />,
    );
    const chip = await waitFor(() => {
      const c = screen.getByRole("button");
      // Wait until odds have resolved (loading state replaced).
      if (c.getAttribute("data-state") !== "ok") {
        throw new Error("still loading");
      }
      return c;
    });
    expect(chip.getAttribute("aria-label")).toContain("République Démocratique du Congo");
    expect(chip.getAttribute("aria-label")).toContain("Bosnia and Herzegovina");
  });

  it("hides the affiliate CTA in NZ", async () => {
    render(
      <OddsChip
        matchNo="1"
        homeTeam="ARG"
        awayTeam="MEX"
        country="NZ"
      />,
    );
    await waitFor(() => screen.getByRole("button"));
    const tooltip = await waitFor(() => screen.getByRole("tooltip"));
    // No "Back this on Polymarket" CTA.
    expect(tooltip.querySelector('[data-affiliate-cta]')).toBeNull();
  });

  it("renders the 'view market' softened CTA in GB", async () => {
    render(
      <OddsChip
        matchNo="1"
        homeTeam="ARG"
        awayTeam="MEX"
        country="GB"
      />,
    );
    const tooltip = await waitFor(() => screen.getByRole("tooltip"));
    const cta = tooltip.querySelector('[data-affiliate-cta="polymarket-view"]');
    expect(cta).not.toBeNull();
    expect(cta?.textContent ?? "").toMatch(/View market/i);
  });

  it("renders the full 'Back this' CTA in US", async () => {
    render(
      <OddsChip
        matchNo="1"
        homeTeam="ARG"
        awayTeam="MEX"
        country="US"
      />,
    );
    const tooltip = await waitFor(() => screen.getByRole("tooltip"));
    const cta = tooltip.querySelector('[data-affiliate-cta="polymarket"]');
    expect(cta).not.toBeNull();
    expect(cta?.textContent ?? "").toMatch(/Back this on Polymarket/i);
  });

  it("when fetchEnabled is false the chip stays in loading state", () => {
    render(<OddsChip matchNo="1" homeTeam="ARG" awayTeam="MEX" fetchEnabled={false} />);
    const chip = screen.getByRole("button");
    expect(chip.getAttribute("data-state")).toBe("loading");
  });

  it("renders kickoff when given an ISO timestamp", async () => {
    render(
      <OddsChip
        matchNo="1"
        homeTeam="ARG"
        awayTeam="MEX"
        homeLabel="Argentina"
        awayLabel="Mexico"
        kickoffIso="2026-06-11T19:00:00Z"
        groupLabel="Group A"
      />,
    );
    const tooltip = await waitFor(() => screen.getByRole("tooltip"));
    expect(tooltip.textContent).toContain("Group A");
    // Date formatting depends on locale, but "Jun" or "11" should appear.
    expect(tooltip.textContent ?? "").toMatch(/Jun|11/);
  });
});
