/**
 * The game service knows every tournament the bracket engine vendors,
 * not only the 2026 World Cup: kickoff lockout, the share-page fixture
 * set and the leaderboard's kickoff catalogue all resolve by id.
 */
import { describe, expect, it } from "vitest";

import { buildDefaultKickoffRegistry, isVendoredTournament } from "../src/kickoffs.js";
import { fixturesForTournament } from "../src/routes/bracket-by-guid.js";
import { kickoffCatalogue } from "../src/routes/leaderboard.js";

describe("vendored tournaments", () => {
  it("recognises both vendored ids and nothing else", () => {
    expect(isVendoredTournament("fifa-wc-2026")).toBe(true);
    expect(isVendoredTournament("rwc-2027")).toBe(true);
    expect(isVendoredTournament("rwc-2023")).toBe(false);
    expect(isVendoredTournament("")).toBe(false);
  });

  it("kickoff registry: RWC 2027 kickoffs and stages, cached per id, null for unknown", () => {
    const registry = buildDefaultKickoffRegistry();
    const rwc = registry.forTournament("rwc-2027");
    expect(rwc.tournamentId).toBe("rwc-2027");
    expect(rwc.kickoffFor("1")).toBe("2027-10-01T10:45:00Z");
    expect(rwc.stageFor("1")).toBe("group");
    expect(rwc.kickoffFor("final")).toBe("2027-11-13T09:00:00Z");
    expect(rwc.stageFor("tp_01")).toBe("tp");
    expect(rwc.kickoffFor("r32_01")).toBeNull(); // no round of 32 in rugby
    expect(registry.forTournament("rwc-2027")).toBe(rwc);
    const wc = registry.forTournament("fifa-wc-2026");
    expect(wc.kickoffFor("1")).toBe("2026-06-11T19:00:00Z");
    const unknown = registry.forTournament("rwc-2023");
    expect(unknown.tournamentId).toBe("");
    expect(unknown.kickoffFor("1")).toBeNull();
    expect(unknown.stageFor("1")).toBeNull();
  });

  it("share page: the fixture set follows the bracket's tournament id, unknown ids fall back to 2026", () => {
    expect(fixturesForTournament("rwc-2027").id).toBe("rwc-2027");
    expect(fixturesForTournament("rwc-2027").groups).toHaveLength(6);
    expect(fixturesForTournament("fifa-wc-2026").id).toBe("fifa-wc-2026");
    expect(fixturesForTournament("nope").id).toBe("fifa-wc-2026");
    expect(fixturesForTournament("rwc-2027")).toBe(fixturesForTournament("rwc-2027"));
  });

  it("leaderboard: the kickoff catalogue has all 52 RWC 2027 matches and nothing for unknown ids", () => {
    const rwc = kickoffCatalogue("rwc-2027");
    expect(rwc.size).toBe(52);
    expect(rwc.get("36")).toBe(Date.parse("2027-10-17T11:15:00Z")); // RSA v ROU, 19:15 AWST
    expect(rwc.get("final")).toBe(Date.parse("2027-11-13T09:00:00Z"));
    expect(kickoffCatalogue("fifa-wc-2026").size).toBe(104);
    expect(kickoffCatalogue("rwc-2023").size).toBe(0);
  });
});
