/**
 * Auto-pick cascade integration test.
 *
 * Verifies the recent fixes from Tim's feedback:
 *   1. ⚡ Auto-pick fills EVERY match in one click, group + R32 + R16
 *      + QF + SF + 3rd-place + Final. Earlier behaviour required
 *      multiple clicks because the cascade only resolved one round per
 *      pass.
 *   2. Each pick records an `oddsAtLock` snapshot for the lock-time-
 *      odds scoring rule.
 *   3. Every change appends an entry to the `vtorn:bracket:history:v1`
 *      ledger, so analytics can replay user activity post-match.
 *   4. Tiebreakers get a default ranking applied so the cascade
 *      doesn't stall on un-broken group ties.
 */

// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { loadFixtures2026 } from "@tournamental/bracket-engine";

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
  if (typeof window !== "undefined") {
    window.history.replaceState(null, "", "/");
  }
  vi.spyOn(global, "fetch").mockImplementation(((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/odds/country")) {
      return Promise.resolve(jsonResponse({ country: "US" }));
    }
    if (url.includes("/api/odds/snapshot")) {
      // Deterministic favourites: home wins every group match (60/25/15);
      // for any knockout that lands here later we'd return similar but
      // the snapshot endpoint only returns group fixtures, which is
      // fine, the cascade falls back to FIFA rank for KO matches with
      // no per-match odds (covered by the recursive cascade pass).
      const matches: MatchOdds[] = tournament.group_fixtures.map((f) => ({
        matchNo: String(f.match_no),
        homeTeam: "MEX",
        awayTeam: "RSA",
        homeWin: 0.6,
        draw: 0.25,
        awayWin: 0.15,
        source: "polymarket",
        updatedAt: new Date().toISOString(),
      }));
      return Promise.resolve(
        jsonResponse({ matches, source: "polymarket", updatedAt: new Date().toISOString() }),
      );
    }
    return Promise.resolve(jsonResponse({ ok: true }));
  }) as typeof fetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("⚡ Auto-pick recursive cascade", () => {
  it("fills every group match (72) AND every knockout (32) in a single click", async () => {
    render(<BracketBuilder tournament={tournament} />);

    // Click the ⚡ Auto-pick tab → confirmation modal opens.
    fireEvent.click(screen.getByRole("button", { name: /Auto-pick from live odds/ }));
    const confirmBtn = await screen.findByRole("button", { name: /Yes, auto-pick/ });
    fireEvent.click(confirmBtn);

    // Wait for the picks to settle into localStorage.
    await waitFor(
      () => {
        const userId = window.localStorage.getItem("vtorn:local_user_id");
        if (!userId) throw new Error("no user id yet");
        const draftRaw = window.localStorage.getItem(
          `vtorn:bracket:v2:${tournament.id}:${userId}`,
        );
        if (!draftRaw) throw new Error("no draft yet");
        const draft = JSON.parse(draftRaw);
        const groupCount = Object.keys(draft.matchPredictions ?? {}).length;
        const koCount = Object.keys(draft.knockoutPredictions ?? {}).length;
        if (groupCount !== 72) throw new Error(`group count = ${groupCount}, want 72`);
        if (koCount !== tournament.knockouts.length) {
          throw new Error(`ko count = ${koCount}, want ${tournament.knockouts.length}`);
        }
        return draft;
      },
      { timeout: 5_000 },
    );
  });

  it("captures the live odds snapshot in `oddsAtLock` for every group pick", async () => {
    render(<BracketBuilder tournament={tournament} />);
    fireEvent.click(screen.getByRole("button", { name: /Auto-pick from live odds/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Yes, auto-pick/ }));

    await waitFor(() => {
      const userId = window.localStorage.getItem("vtorn:local_user_id")!;
      const draft = JSON.parse(
        window.localStorage.getItem(`vtorn:bracket:v2:${tournament.id}:${userId}`) ?? "{}",
      );
      const first = draft.matchPredictions?.["1"];
      if (!first?.oddsAtLock) throw new Error("oddsAtLock missing");
      expect(first.oddsAtLock.homeWin).toBeCloseTo(0.6, 2);
      expect(first.oddsAtLock.draw).toBeCloseTo(0.25, 2);
      expect(first.oddsAtLock.awayWin).toBeCloseTo(0.15, 2);
      expect(first.oddsAtLock.source).toBe("polymarket");
      expect(typeof first.oddsAtLock.capturedAt).toBe("string");
    });
  });

  it("appends an entry to the prediction-history ledger for every change", async () => {
    render(<BracketBuilder tournament={tournament} />);
    fireEvent.click(screen.getByRole("button", { name: /Auto-pick from live odds/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Yes, auto-pick/ }));

    await waitFor(() => {
      const userId = window.localStorage.getItem("vtorn:local_user_id")!;
      const histRaw = window.localStorage.getItem(
        `vtorn:bracket:history:v1:${tournament.id}:${userId}`,
      );
      if (!histRaw) throw new Error("no history yet");
      const history = JSON.parse(histRaw);
      expect(Array.isArray(history)).toBe(true);
      // 72 group picks + 32 knockout picks + 12 tiebreakers + 1 run marker = 117.
      expect(history.length).toBeGreaterThanOrEqual(72);
      expect(history.some((e: { type: string }) => e.type === "auto_pick_run")).toBe(true);
      expect(history.some((e: { type: string }) => e.type === "match_pick")).toBe(true);
      expect(history.some((e: { type: string }) => e.type === "knockout_pick")).toBe(true);
      expect(history.some((e: { type: string }) => e.type === "tiebreaker_set")).toBe(true);
    });
  });

  it("sets a default tiebreaker for every group", async () => {
    render(<BracketBuilder tournament={tournament} />);
    fireEvent.click(screen.getByRole("button", { name: /Auto-pick from live odds/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Yes, auto-pick/ }));

    await waitFor(() => {
      const userId = window.localStorage.getItem("vtorn:local_user_id")!;
      const draft = JSON.parse(
        window.localStorage.getItem(`vtorn:bracket:v2:${tournament.id}:${userId}`) ?? "{}",
      );
      const tbCount = Object.keys(draft.groupTiebreakers ?? {}).length;
      // 12 groups in the WC2026 fixtures.
      expect(tbCount).toBe(12);
    });
  });
});
