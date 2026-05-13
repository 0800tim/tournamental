/**
 * Unit tests for the molecule's "global prediction" Bracket builder.
 *
 * Two surfaces under test:
 *  1. `buildOddsConsensusBracket` against a known odds map — picks the
 *     highest-probability outcome per match, falls back to world rank
 *     when a match is missing from the map.
 *  2. `fetchOddsSnapshotMap` against a mocked fetch — tolerates 404,
 *     malformed JSON, and abort.
 */
import { describe, it, expect } from "vitest";
import { loadFixtures2026 } from "@tournamental/bracket-engine";

import type { MatchOdds } from "@/lib/odds/types";
import {
  buildOddsConsensusBracket,
  fetchOddsSnapshotMap,
} from "../odds-consensus";

function oddsRow(matchNo: number | string, h: number, d: number | null, a: number): MatchOdds {
  return {
    matchNo: String(matchNo),
    homeTeam: "",
    awayTeam: "",
    homeWin: h,
    draw: d,
    awayWin: a,
    source: "mock-fifa-rank",
    updatedAt: new Date().toISOString(),
  };
}

describe("buildOddsConsensusBracket", () => {
  const tournament = loadFixtures2026();

  it("picks the highest-probability outcome for every group fixture", () => {
    const oddsByMatch = new Map<string, MatchOdds>();
    for (const f of tournament.group_fixtures) {
      // Deterministic: home always wins.
      oddsByMatch.set(String(f.match_no), oddsRow(f.match_no, 0.7, 0.2, 0.1));
    }
    const bracket = buildOddsConsensusBracket(tournament, oddsByMatch);
    for (const f of tournament.group_fixtures) {
      expect(bracket.matchPredictions[String(f.match_no)].outcome).toBe(
        "home_win",
      );
    }
  });

  it("falls back to world-rank heuristic when a fixture is missing from the snapshot", () => {
    const bracket = buildOddsConsensusBracket(tournament, new Map());
    // Every group fixture must still have a prediction (rank fallback).
    for (const f of tournament.group_fixtures) {
      const p = bracket.matchPredictions[String(f.match_no)];
      expect(p).toBeTruthy();
      expect(["home_win", "draw", "away_win"]).toContain(p.outcome);
    }
  });

  it("populates group tiebreakers for every 4-team group", () => {
    const bracket = buildOddsConsensusBracket(tournament, new Map());
    for (const g of tournament.groups) {
      if (g.team_ids.length !== 4) continue;
      const tb = bracket.groupTiebreakers[g.id];
      expect(tb).toBeTruthy();
      expect(tb.rankedTeams).toHaveLength(4);
      expect(new Set(tb.rankedTeams)).toEqual(new Set(g.team_ids));
    }
  });

  it("populates knockout predictions through to the final", () => {
    const bracket = buildOddsConsensusBracket(tournament, new Map());
    const koIds = tournament.knockouts.map((k) => k.id);
    // We expect predictions for at least one match per stage.
    const stages = new Set(
      tournament.knockouts
        .filter((k) => bracket.knockoutPredictions[k.id])
        .map((k) => k.stage),
    );
    expect(stages.has("r32")).toBe(true);
    expect(stages.has("f")).toBe(true);
    // Every populated prediction must reference a real knockout id.
    for (const id of Object.keys(bracket.knockoutPredictions)) {
      expect(koIds).toContain(id);
    }
  });

  it("draw wins when its probability is the maximum", () => {
    const fixture = tournament.group_fixtures[0];
    const oddsByMatch = new Map<string, MatchOdds>([
      [String(fixture.match_no), oddsRow(fixture.match_no, 0.2, 0.6, 0.2)],
    ]);
    const bracket = buildOddsConsensusBracket(tournament, oddsByMatch);
    expect(bracket.matchPredictions[String(fixture.match_no)].outcome).toBe(
      "draw",
    );
  });
});

describe("fetchOddsSnapshotMap", () => {
  it("returns an empty map when the response is not ok", async () => {
    const fakeFetch = (async () =>
      new Response("nope", { status: 503 })) as unknown as typeof fetch;
    const m = await fetchOddsSnapshotMap(fakeFetch);
    expect(m.size).toBe(0);
  });

  it("returns an empty map when the body is malformed", async () => {
    const fakeFetch = (async () =>
      new Response("not json", { status: 200 })) as unknown as typeof fetch;
    const m = await fetchOddsSnapshotMap(fakeFetch);
    expect(m.size).toBe(0);
  });

  it("parses a well-formed snapshot into a Map keyed by matchNo", async () => {
    const payload = {
      matches: [
        oddsRow(1, 0.5, 0.3, 0.2),
        oddsRow(2, 0.1, 0.2, 0.7),
      ],
    };
    const fakeFetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const m = await fetchOddsSnapshotMap(fakeFetch);
    expect(m.size).toBe(2);
    expect(m.get("1")?.homeWin).toBe(0.5);
    expect(m.get("2")?.awayWin).toBe(0.7);
  });
});
