/**
 * Tournament registry (lib/tournaments/registry.ts): the single switch
 * that decides which host serves the active tournament, the hub, or a
 * read-only archive. Pure data and pure functions, imported by the
 * edge middleware, so these tests need no DOM, DB or network.
 */
import { describe, expect, it } from "vitest";

import { ARCHIVE_HEADER, HUB_HEADER } from "@/lib/archive/server";
import {
  TOURNAMENTS,
  activeTournament,
  archiveForHost,
  archivedTournaments,
  tournamentBySlug,
  upcomingTournament,
} from "@/lib/tournaments/registry";

describe("registry status helpers", () => {
  it("has no active tournament right now (play host is the hub)", () => {
    expect(activeTournament()).toBeNull();
  });

  it("promotes RWC 2027 as the upcoming tournament", () => {
    expect(upcomingTournament()?.id).toBe("rwc-2027");
    expect(upcomingTournament()?.slug).toBe("rwc2027");
  });

  it("lists FWC 2026 as the only archive, with an archive host", () => {
    const archived = archivedTournaments();
    expect(archived.map((t) => t.id)).toEqual(["fifa-wc-2026"]);
    expect(archived[0]?.archiveHost).toBe("fwc2026.tournamental.com");
  });

  it("finds entries by slug and returns null for unknown slugs", () => {
    expect(tournamentBySlug("fwc2026")?.id).toBe("fifa-wc-2026");
    expect(tournamentBySlug("rwc2027")?.id).toBe("rwc-2027");
    expect(tournamentBySlug("fwc2022")).toBeNull();
  });

  it("has at most one active and one upcoming tournament", () => {
    expect(TOURNAMENTS.filter((t) => t.status === "active").length).toBeLessThanOrEqual(1);
    expect(TOURNAMENTS.filter((t) => t.status === "upcoming").length).toBeLessThanOrEqual(1);
  });

  it("gives every archived tournament an archive host and a unique slug", () => {
    const slugs = new Set<string>();
    for (const t of TOURNAMENTS) {
      expect(slugs.has(t.slug)).toBe(false);
      slugs.add(t.slug);
      if (t.status === "archived") expect(t.archiveHost).toMatch(/^[a-z0-9]+\.tournamental\.com$/);
    }
  });
});

describe("archiveForHost", () => {
  it("maps the canonical archive host to FWC 2026", () => {
    expect(archiveForHost("fwc2026.tournamental.com")?.id).toBe("fifa-wc-2026");
  });

  it("is case-insensitive on the host", () => {
    expect(archiveForHost("FWC2026.Tournamental.COM")?.id).toBe("fifa-wc-2026");
  });

  it("maps <slug>.localhost for local development", () => {
    expect(archiveForHost("fwc2026.localhost")?.id).toBe("fifa-wc-2026");
  });

  it("returns null for the play host, the marketing host and unknown hosts", () => {
    expect(archiveForHost("play.tournamental.com")).toBeNull();
    expect(archiveForHost("tournamental.com")).toBeNull();
    expect(archiveForHost("localhost")).toBeNull();
    expect(archiveForHost("")).toBeNull();
  });

  it("does not treat the archive aliases as archives (middleware 301s them)", () => {
    expect(archiveForHost("wc2026.tournamental.com")).toBeNull();
    expect(archiveForHost("2026wc.tournamental.com")).toBeNull();
  });

  it("never serves an upcoming tournament as an archive", () => {
    expect(archiveForHost("rwc2027.tournamental.com")).toBeNull();
    expect(archiveForHost("rwc2027.localhost")).toBeNull();
  });

  it("ignores a port suffix only when the caller strips it", () => {
    // Middleware strips the port before calling; the helper itself is strict.
    expect(archiveForHost("fwc2026.localhost:3300")).toBeNull();
  });
});

describe("public engagement stats", () => {
  it("are percentages or ranks only, never raw player counts (Tim 2026-10-15)", () => {
    for (const t of TOURNAMENTS) {
      for (const s of t.stats ?? []) {
        expect(s.value).toMatch(/^(\d{1,3}%|#\d+)$/);
        expect(s.label).not.toMatch(/\b\d{2,}\b/);
      }
    }
  });

  it("records the FWC 2026 podium", () => {
    const fwc = tournamentBySlug("fwc2026");
    expect(fwc?.winner?.code).toBe("ESP");
    expect(fwc?.runnerUp?.code).toBe("ARG");
    expect(fwc?.third?.code).toBe("ENG");
  });
});

describe("header names shared with the middleware", () => {
  it("are the strings the middleware stamps", () => {
    expect(ARCHIVE_HEADER).toBe("x-tnm-archive");
    expect(HUB_HEADER).toBe("x-tnm-hub");
  });
});
