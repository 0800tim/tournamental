/**
 * Sage strategy tests.
 *
 * The strategy module is the only piece of Sage that has interesting branching
 * (parser + fallback). The cron loop is wired directly to PM2; integration is
 * smoke-tested in Task 21 of the Phase 1 plan, not here.
 */

import { describe, it, expect } from "vitest";

import type { MatchSpec, OddsSnapshot } from "@tournamental/bot-sdk";

import {
  buildPrompt,
  decide,
  favourite,
  parseOutcome,
  type ClaudeLike,
  type ClaudeResponse,
} from "../src/strategy.js";

const MATCH: MatchSpec = {
  id: "1",
  stage: "group",
  home_code: "ARG",
  away_code: "FRA",
  kickoff_utc: "2026-06-11T18:00:00Z",
};

const ODDS: OddsSnapshot = {
  match_id: "1",
  home_win: 0.45,
  draw: 0.25,
  away_win: 0.3,
  source: "polymarket",
};

function fakeClaude(text: string): ClaudeLike {
  return {
    messages: {
      create: async (): Promise<ClaudeResponse> => ({
        content: [{ type: "text", text }],
      }),
    },
  };
}

function explodingClaude(): ClaudeLike {
  return {
    messages: {
      create: async (): Promise<ClaudeResponse> => {
        throw new Error("simulated 503");
      },
    },
  };
}

describe("parseOutcome", () => {
  it("accepts the three canonical tokens", () => {
    expect(parseOutcome("home_win")).toBe("home_win");
    expect(parseOutcome("draw")).toBe("draw");
    expect(parseOutcome("away_win")).toBe("away_win");
  });

  it("trims whitespace and trailing punctuation", () => {
    expect(parseOutcome(" home_win\n")).toBe("home_win");
    expect(parseOutcome("draw.")).toBe("draw");
    expect(parseOutcome("`away_win`")).toBe("away_win");
  });

  it("rejects anything else", () => {
    expect(parseOutcome("HomeWin")).toBeNull();
    expect(parseOutcome("Argentina wins")).toBeNull();
    expect(parseOutcome("")).toBeNull();
    expect(parseOutcome("home_win because Messi")).toBeNull();
  });
});

describe("favourite", () => {
  it("picks the highest implied probability", () => {
    expect(favourite(ODDS)).toBe("home_win");
    expect(
      favourite({ ...ODDS, home_win: 0.2, draw: 0.2, away_win: 0.6 }),
    ).toBe("away_win");
    expect(
      favourite({ ...ODDS, home_win: 0.2, draw: 0.6, away_win: 0.2 }),
    ).toBe("draw");
  });

  it("defaults to home_win when no odds available", () => {
    expect(favourite(null)).toBe("home_win");
  });
});

describe("buildPrompt", () => {
  it("includes both team codes and odds", () => {
    const prompt = buildPrompt(MATCH, ODDS);
    expect(prompt).toContain("ARG");
    expect(prompt).toContain("FRA");
    expect(prompt).toContain("0.450");
    expect(prompt).toContain("home_win | draw | away_win");
  });

  it("flags no live market when odds are null", () => {
    const prompt = buildPrompt(MATCH, null);
    expect(prompt).toContain("no live market");
  });
});

describe("decide", () => {
  it("returns Claude's pick when it is one of the three tokens", async () => {
    const claude = fakeClaude("draw");
    expect(await decide(MATCH, ODDS, { claude })).toBe("draw");
  });

  it("falls back to the favourite when Claude returns garbage", async () => {
    const claude = fakeClaude("I think Argentina will win on penalties.");
    // favourite of ODDS is home_win (0.45)
    expect(await decide(MATCH, ODDS, { claude })).toBe("home_win");
  });

  it("falls back to the favourite when Claude throws", async () => {
    const claude = explodingClaude();
    expect(await decide(MATCH, ODDS, { claude })).toBe("home_win");
  });

  it("falls back to home_win when there are no odds and Claude misbehaves", async () => {
    const claude = fakeClaude("???");
    expect(await decide(MATCH, null, { claude })).toBe("home_win");
  });

  it("returns favourite without a client (test/dev shortcut)", async () => {
    expect(await decide(MATCH, ODDS)).toBe("home_win");
  });
});
