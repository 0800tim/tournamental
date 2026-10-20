/**
 * The chrome fields added to the tournament registry on 2026-10-20
 * (design note docs/design/registry-driven-tournament-chrome.md, steps
 * 1 and 2): every entry carries a code and a route base, the FWC
 * archive carries its alias hosts and marketing path, and the
 * summary helper hands client components only what the chrome needs.
 */
import { describe, expect, it } from "vitest";

import {
  TOURNAMENTS,
  archivedTournaments,
  chromeTournament,
  summarise,
  tournamentBySlug,
  upcomingTournament,
} from "@/lib/tournaments/registry";

describe("registry chrome fields", () => {
  it("gives every entry a code and a route base", () => {
    for (const t of TOURNAMENTS) {
      expect(t.code, t.slug).toMatch(/^[A-Z]{3}\d{4}$/);
      expect(t.routeBase, t.slug).toMatch(/^\/[a-z0-9-]+$/);
    }
    expect(tournamentBySlug("fwc2026")!.code).toBe("FWC2026");
    expect(tournamentBySlug("fwc2026")!.routeBase).toBe("/world-cup-2026");
    expect(tournamentBySlug("rwc2027")!.code).toBe("RWC2027");
  });

  it("keeps the archive alias hosts and marketing path with the archived entry", () => {
    const fwc = tournamentBySlug("fwc2026")!;
    expect(fwc.aliasHosts).toEqual(["wc2026.tournamental.com", "2026wc.tournamental.com"]);
    expect(fwc.marketingArchivePath).toBe("/archive/fwc-2026");
    expect(fwc.archiveHost).toBe("fwc2026.tournamental.com");
  });

  it("points the hub art at the upcoming entry's folder", () => {
    expect(upcomingTournament()!.artDir).toBe("/rwc2027/");
  });

  it("summarises to the chrome slice only", () => {
    const s = summarise(tournamentBySlug("fwc2026"))!;
    expect(Object.keys(s).sort()).toEqual(["archiveHost", "code", "endsUtc", "name", "routeBase", "shortName", "slug"]);
    expect(s).not.toHaveProperty("stats");
    expect(summarise(null)).toBeNull();
  });

  it("picks the newest archived entry for the live chrome while nothing is active", () => {
    const archived = archivedTournaments();
    expect(chromeTournament()).toBe(archived[archived.length - 1]);
    expect(chromeTournament()!.slug).toBe("fwc2026");
  });
});
