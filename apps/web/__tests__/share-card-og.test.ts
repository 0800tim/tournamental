/**
 * Tests for /api/og/[bracketId] + the bracket-share-payload helpers.
 *
 * Calls the Next route handler directly (no server). Asserts on status,
 * headers, byte length, and the decoded payload shape.
 */

import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";

import {
  decodeBracketPayload,
  encodeBracketPayload,
  flagEmoji,
  buildShareCaption,
  buildShareTitle,
  buildShareDescription,
  type BracketSharePayload,
} from "@/lib/share/payload";

describe("decodeBracketPayload", () => {
  it("returns sensible defaults for an empty query string", () => {
    const p = decodeBracketPayload("test-bracket-123", new URLSearchParams(""));
    expect(p.bracketId).toBe("test-bracket-123");
    expect(p.handle).toBe("anonymous");
    expect(p.winnerCode).toBe("TBD");
    expect(p.tournamentName).toBe("FIFA World Cup 2026");
    expect(p.route.length).toBe(4);
    expect(p.route[3]?.stage).toBe("FINAL");
  });

  it("parses handle / winner / route from clean query keys", () => {
    const sp = new URLSearchParams(
      "handle=messi-fan&winner=Argentina&winnerCode=ARG&route=ARG:Argentina|BRA:Brazil|FRA:France|ARG:Argentina",
    );
    const p = decodeBracketPayload("b1", sp);
    expect(p.handle).toBe("messi-fan");
    expect(p.winnerName).toBe("Argentina");
    expect(p.winnerCode).toBe("ARG");
    expect(p.route.map((r) => r.teamCode)).toEqual(["ARG", "BRA", "FRA", "ARG"]);
    expect(p.route.map((r) => r.stage)).toEqual(["R16", "QF", "SF", "FINAL"]);
  });

  it("falls back to the URL params when `p=` base64 is malformed", () => {
    const sp = new URLSearchParams("p=!!notbase64!!&handle=bob");
    const p = decodeBracketPayload("b1", sp);
    expect(p.handle).toBe("bob");
  });

  it("round-trips through encodeBracketPayload", () => {
    const start: BracketSharePayload = {
      bracketId: "b1",
      handle: "tim",
      winnerCode: "FRA",
      winnerName: "France",
      winnerFlagEmoji: "🇫🇷",
      route: [
        { stage: "R16", teamCode: "FRA", teamName: "France", flagEmoji: "🇫🇷" },
        { stage: "QF", teamCode: "ENG", teamName: "England", flagEmoji: "🏴" },
        { stage: "SF", teamCode: "ARG", teamName: "Argentina", flagEmoji: "🇦🇷" },
        { stage: "FINAL", teamCode: "FRA", teamName: "France", flagEmoji: "🇫🇷" },
      ],
      tournamentName: "FIFA World Cup 2026",
      tagline: "Vamos",
      longShotCount: 4,
    };
    const sp = encodeBracketPayload(start);
    const decoded = decodeBracketPayload("b1", sp);
    expect(decoded.handle).toBe("tim");
    expect(decoded.winnerName).toBe("France");
    expect(decoded.winnerCode).toBe("FRA");
    expect(decoded.tagline).toBe("Vamos");
    expect(decoded.longShotCount).toBe(4);
    expect(decoded.route.length).toBe(4);
    expect(decoded.route[1]?.teamCode).toBe("ENG");
  });
});

describe("flagEmoji", () => {
  it("converts a 2-letter ISO code to the regional-indicator pair", () => {
    expect(flagEmoji("NZ")).toBe("🇳🇿");
    expect(flagEmoji("nz")).toBe("🇳🇿");
  });
  it("returns undefined for an alpha-3 or empty input", () => {
    expect(flagEmoji("ARG")).toBeUndefined();
    expect(flagEmoji(undefined)).toBeUndefined();
    expect(flagEmoji("")).toBeUndefined();
  });
  it("rejects non-alpha characters", () => {
    expect(flagEmoji("12")).toBeUndefined();
    expect(flagEmoji("A1")).toBeUndefined();
  });
});

describe("buildShare* helpers", () => {
  const p: BracketSharePayload = {
    bracketId: "b1",
    handle: "tim",
    winnerCode: "FRA",
    winnerName: "France",
    route: [
      { stage: "R16", teamCode: "FRA", teamName: "France" },
      { stage: "QF", teamCode: "FRA", teamName: "France" },
      { stage: "SF", teamCode: "FRA", teamName: "France" },
      { stage: "FINAL", teamCode: "FRA", teamName: "France" },
    ],
    tournamentName: "FIFA World Cup 2026",
  };

  it("buildShareTitle mentions handle + tournament", () => {
    expect(buildShareTitle(p)).toContain("@tim");
    expect(buildShareTitle(p)).toContain("FIFA World Cup 2026");
  });
  it("buildShareDescription names the winner", () => {
    expect(buildShareDescription(p)).toContain("France");
    expect(buildShareDescription(p)).toContain("tim");
  });
  it("buildShareCaption embeds the URL + brand handle", () => {
    const c = buildShareCaption(p, "https://vtourn.com/share/b1");
    expect(c).toContain("@VTourn");
    expect(c).toContain("https://vtourn.com/share/b1");
    expect(c).toContain("France");
  });
});

describe("GET /api/og/[bracketId]", () => {
  // Importing the route requires next/server + satori, both of which work in
  // node test env. Note: this is an integration-style test — it actually
  // renders the PNG. Slow-ish (~200ms) but covers the whole pipeline.
  it("returns a PNG with the correct cache headers", async () => {
    const { GET } = await import("@/app/api/og/[bracketId]/route");
    const req = new NextRequest(
      new URL("http://localhost/api/og/test-bracket-123?handle=messi-fan&winner=Argentina&winnerCode=ARG"),
    );
    const res = await GET(req, { params: { bracketId: "test-bracket-123" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const cc = res.headers.get("cache-control");
    expect(cc).toContain("public");
    expect(cc).toContain("max-age=3600");
    expect(cc).toContain("stale-while-revalidate=86400");
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(1000); // a real PNG, not a tiny error blob
  }, 30000);

  it("returns 400 on an invalid bracket id", async () => {
    const { GET } = await import("@/app/api/og/[bracketId]/route");
    const req = new NextRequest(new URL("http://localhost/api/og/bad%20id"));
    const res = await GET(req, { params: { bracketId: "bad id with spaces!!" } });
    expect(res.status).toBe(400);
  });

  it("falls back to a default route when no payload provided", async () => {
    const { GET } = await import("@/app/api/og/[bracketId]/route");
    const req = new NextRequest(new URL("http://localhost/api/og/empty"));
    const res = await GET(req, { params: { bracketId: "empty" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  }, 30000);
});
