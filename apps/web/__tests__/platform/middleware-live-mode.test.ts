/**
 * Live mode: once the registry marks a tournament "active", the play
 * host stops being the hub and serves the app as before. The registry
 * is mocked here so the test does not depend on today's real state.
 */
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/tournaments/registry", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tournaments/registry")>();
  const live = { ...real.TOURNAMENTS[1]!, status: "active" as const };
  return {
    ...real,
    activeTournament: () => live,
    upcomingTournament: () => null,
  };
});

import { middleware } from "@/middleware";

const PLAY = "play.tournamental.com";
const ARCHIVE = "fwc2026.tournamental.com";

function run(host: string, path: string, method = "GET") {
  return middleware(new NextRequest(`https://${host}${path}`, { method, headers: { host } }));
}

describe("play host with an active tournament", () => {
  it("serves / as the live home, no hub rewrite, no hub header", () => {
    const res = run(PLAY, "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("x-middleware-request-x-tnm-hub")).toBeNull();
    expect(res.headers.get("location")).toBeNull();
  });

  it("no longer bounces play paths to the archive", () => {
    for (const p of ["/world-cup-2026", "/leaderboard", "/pools/new", "/s/abc123/join"]) {
      const res = run(PLAY, p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get("location"), p).toBeNull();
    }
  });

  it("does not special-case /i/<code> (the app's own route handles invites)", () => {
    const res = run(PLAY, "/i/abcd");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("keeps the legal redirect", () => {
    expect(run(PLAY, "/terms").headers.get("location")).toBe("https://tournamental.com/legal/terms");
  });

  it("leaves the archive host read-only regardless", () => {
    expect(run(ARCHIVE, "/leaderboard").status).toBe(302);
    expect(run(ARCHIVE, "/world-cup-2026", "POST").status).toBe(403);
    expect(run(ARCHIVE, "/").headers.get("x-middleware-request-x-tnm-archive")).toBe("fwc2026");
  });
});
