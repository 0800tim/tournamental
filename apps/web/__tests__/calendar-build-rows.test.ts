/**
 * Sanity tests for the calendar row builder.
 *
 * The /calendar page lives or dies by these invariants:
 *   - We get exactly 104 rows, in match_no order.
 *   - Every group fixture has both home/away codes resolved (Final
 *     Draw is done, no group-stage TBDs).
 *   - Every knockout has both sides UNresolved (the calendar is a
 *     neutral schedule view; TBD descriptors are intentional).
 */

import { describe, it, expect } from "vitest";

import { loadFixtures2026 } from "@tournamental/bracket-engine";

import { buildCalendarRows } from "@/app/world-cup-2026/calendar/build-rows";
import { enrichTournamentTeams, type CanonicalTeamsFile } from "@/lib/bracket/enrich";
import canonicalTeamsRaw from "../../../data/fifa-wc-2026/teams.json";

describe("buildCalendarRows", () => {
  const tournament = enrichTournamentTeams(
    loadFixtures2026(),
    canonicalTeamsRaw as CanonicalTeamsFile,
  );
  const rows = buildCalendarRows(tournament);

  it("emits exactly 104 rows", () => {
    expect(rows).toHaveLength(104);
  });

  it("rows are sorted by match_no with no gaps", () => {
    for (let i = 0; i < rows.length; i += 1) {
      expect(rows[i]!.matchNo).toBe(i + 1);
    }
  });

  it("first 72 rows are group stages with real teams", () => {
    for (let i = 0; i < 72; i += 1) {
      const r = rows[i]!;
      expect(r.stage).toBe("group");
      expect(r.home.code).toBeDefined();
      expect(r.away.code).toBeDefined();
      expect(r.stageBadge.startsWith("GROUP ")).toBe(true);
    }
  });

  it("rows 73-104 are knockouts with TBD slots", () => {
    for (let i = 72; i < 104; i += 1) {
      const r = rows[i]!;
      expect(r.stage).not.toBe("group");
      expect(r.home.code).toBeUndefined();
      expect(r.away.code).toBeUndefined();
      expect(r.home.slotLabel).toBeTruthy();
      expect(r.away.slotLabel).toBeTruthy();
    }
  });

  it("final row is the Final", () => {
    const last = rows[103]!;
    expect(last.matchNo).toBe(104);
    expect(last.stage).toBe("f");
    expect(last.stageBadge).toBe("FINAL #104");
  });

  it("every row carries a venue + host country", () => {
    for (const r of rows) {
      expect(r.venue.length).toBeGreaterThan(0);
      expect(r.host.length).toBeGreaterThan(0);
    }
  });
});
