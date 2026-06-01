/**
 * Unit tests for the ESPN bracket parser.
 *
 * The parser is invoked via the `staticFetcher` helper from
 * apps/web/lib/import/fetcher.ts, which returns canned HTML for a URL
 * prefix. In production the equivalent call routes through Playwright
 * (because ESPN sets needsBrowser: true) and returns the
 * post-hydration HTML. Our fixtures mirror that post-hydration shape.
 *
 * Real Playwright behaviour is exercised by integration tests later;
 * here we only verify the pure extraction logic and URL recognition.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { espnParser, parseHtml } from "@/lib/import/parsers/espn";
import { normaliseTeamName } from "@/lib/import/team-normalise";
import type { Fetcher } from "@/lib/import/types";

/**
 * Inline static fetcher for the unit tests.
 *
 * The shared `staticFetcher` lives in apps/web/lib/import/fetcher.ts,
 * but importing that module also pulls in its dynamic `playwright`
 * import which Vite tries to resolve at transform time and fails on
 * (playwright is an optional production-only dep). To keep this test
 * file self-contained and dependency-free, we re-implement the
 * staticFetcher helper here with identical semantics. Integration
 * tests that exercise the real Playwright path live elsewhere.
 */
function staticFetcher(byUrlPrefix: Record<string, string>): Fetcher {
  return {
    async fetch({ url }) {
      for (const [prefix, html] of Object.entries(byUrlPrefix)) {
        if (url.startsWith(prefix)) {
          return { ok: true, html, status: 200, finalUrl: url };
        }
      }
      return { ok: false, status: 404, error: "no-stub" };
    },
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_DIR = path.resolve(
  __dirname,
  "../../lib/import/parsers/__fixtures__",
);

function loadFixture(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, name), "utf8");
}

describe("espnParser.canParse", () => {
  it("accepts canonical ESPN Tournament Challenge URLs", () => {
    const urls = [
      "https://fantasy.espn.com/games/fifa-world-cup-bracket-2026/bracket?entryID=12345",
      "https://fantasy.espn.com/games/fifa-world-cup-bracket-2026/bracket?bracketId=abc",
      "https://fantasy.espn.com/tournament-challenge-bracket-2026/bracket?entryID=12345",
      "https://www.espn.com/fifa-world-cup/bracket/_/entryID/12345",
      "https://www.espn.com/fifa-world-cup/tournament-challenge?entryID=12345",
    ];
    for (const url of urls) {
      expect(espnParser.canParse(url), url).toBe(true);
    }
  });

  it("rejects unrelated URLs", () => {
    const urls = [
      "",
      "not a url",
      "https://www.telegraph.co.uk/world-cup/bracket/123",
      "https://www.bbc.co.uk/sport/football/predictor",
      "https://www.fifa.com/fifaplus/en/match/centre",
      "ftp://espn.com/bracket",
      "https://espn.com/news/article/12345",
    ];
    for (const url of urls) {
      expect(espnParser.canParse(url), url).toBe(false);
    }
  });

  it("declares its source", () => {
    expect(espnParser.source).toBe("espn");
  });
});

describe("espnParser.parse, JSON-in-script path (group-only fixture)", () => {
  const url =
    "https://fantasy.espn.com/games/fifa-world-cup-bracket-2026/bracket?entryID=11";

  it("extracts every pick from the JSON blob", async () => {
    const fetcher = staticFetcher({
      [url]: loadFixture("espn-group-only.html"),
    });
    const result = await espnParser.parse(url, fetcher);
    expect(result.matches).toHaveLength(4);
    const first = result.matches[0];
    expect(first.homeTeamRaw).toBe("Argentina");
    expect(first.awayTeamRaw).toBe("Saudi Arabia");
    expect(first.predictedWinnerRaw).toBe("Argentina");
    expect(first.sourceMatchId).toBe("G1");
    expect(first.kickoffHint).toBe("2026-06-12T18:00:00Z");
  });

  it("flags group-stage draws with the 'draw' sentinel", async () => {
    const fetcher = staticFetcher({
      [url]: loadFixture("espn-group-only.html"),
    });
    const result = await espnParser.parse(url, fetcher);
    const draw = result.matches.find((m) => m.sourceMatchId === "G3");
    expect(draw).toBeDefined();
    expect(draw?.predictedWinnerRaw).toBe("draw");
  });

  it("captures the source user handle", async () => {
    const fetcher = staticFetcher({
      [url]: loadFixture("espn-group-only.html"),
    });
    const result = await espnParser.parse(url, fetcher);
    expect(result.sourceUserHandle).toBe("tim_nz");
  });

  it("normalises every team name to a canonical code", async () => {
    const fetcher = staticFetcher({
      [url]: loadFixture("espn-group-only.html"),
    });
    const result = await espnParser.parse(url, fetcher);
    for (const m of result.matches) {
      expect(normaliseTeamName(m.homeTeamRaw), m.homeTeamRaw).not.toBeNull();
      expect(normaliseTeamName(m.awayTeamRaw), m.awayTeamRaw).not.toBeNull();
      if (m.predictedWinnerRaw !== "draw") {
        expect(
          normaliseTeamName(m.predictedWinnerRaw),
          m.predictedWinnerRaw,
        ).not.toBeNull();
      }
    }
  });
});

describe("espnParser.parse, DOM fallback path (full-bracket fixture)", () => {
  const url = "https://www.espn.com/fifa-world-cup/bracket/_/entryID/22";

  it("extracts every matchup the user has filled in", async () => {
    const fetcher = staticFetcher({
      [url]: loadFixture("espn-full-bracket.html"),
    });
    const result = await espnParser.parse(url, fetcher);
    // 4 R16 + 2 QF + 1 SF + 1 F = 8
    expect(result.matches).toHaveLength(8);
  });

  it("identifies the winner via .is-winner", async () => {
    const fetcher = staticFetcher({
      [url]: loadFixture("espn-full-bracket.html"),
    });
    const result = await espnParser.parse(url, fetcher);
    const r161 = result.matches.find((m) => m.sourceMatchId === "R16-1");
    expect(r161?.homeTeamRaw).toBe("Argentina");
    expect(r161?.awayTeamRaw).toBe("Netherlands");
    expect(r161?.predictedWinnerRaw).toBe("Argentina");
  });

  it("identifies the winner via aria-selected='true' as a fallback", async () => {
    const fetcher = staticFetcher({
      [url]: loadFixture("espn-full-bracket.html"),
    });
    const result = await espnParser.parse(url, fetcher);
    const sf = result.matches.find((m) => m.sourceMatchId === "SF-1");
    expect(sf?.predictedWinnerRaw).toBe("Brazil");
  });

  it("extracts champion + runner-up + handle", async () => {
    const fetcher = staticFetcher({
      [url]: loadFixture("espn-full-bracket.html"),
    });
    const result = await espnParser.parse(url, fetcher);
    expect(result.championRaw).toBe("Brazil");
    expect(result.runnerUpRaw).toBe("France");
    expect(result.sourceUserHandle).toBe("Lionel_M");
  });

  it("normalises every extracted team to a canonical code", async () => {
    const fetcher = staticFetcher({
      [url]: loadFixture("espn-full-bracket.html"),
    });
    const result = await espnParser.parse(url, fetcher);
    for (const m of result.matches) {
      expect(normaliseTeamName(m.homeTeamRaw), m.homeTeamRaw).not.toBeNull();
      expect(normaliseTeamName(m.awayTeamRaw), m.awayTeamRaw).not.toBeNull();
      expect(
        normaliseTeamName(
          m.predictedWinnerRaw === "draw" ? m.homeTeamRaw : m.predictedWinnerRaw,
        ),
      ).not.toBeNull();
    }
    expect(normaliseTeamName(result.championRaw!)).toBe("BRA");
    expect(normaliseTeamName(result.runnerUpRaw!)).toBe("FRA");
  });
});

describe("espnParser.parse, empty bracket", () => {
  const url =
    "https://fantasy.espn.com/games/fifa-world-cup-bracket-2026/bracket?entryID=99";

  it("returns an empty matches array without throwing", async () => {
    const fetcher = staticFetcher({
      [url]: loadFixture("espn-empty.html"),
    });
    const result = await espnParser.parse(url, fetcher);
    expect(result.matches).toEqual([]);
  });

  it("still captures the source user handle when present", async () => {
    const fetcher = staticFetcher({
      [url]: loadFixture("espn-empty.html"),
    });
    const result = await espnParser.parse(url, fetcher);
    expect(result.sourceUserHandle).toBe("new_player");
  });
});

describe("espnParser.parse, fetch failures", () => {
  it("throws when the fetcher cannot resolve the URL", async () => {
    const fetcher = staticFetcher({});
    await expect(
      espnParser.parse(
        "https://fantasy.espn.com/games/fifa-world-cup-bracket-2026/bracket?entryID=missing",
        fetcher,
      ),
    ).rejects.toThrow(/espn-fetch-failed/);
  });
});

describe("parseHtml pure extraction", () => {
  it("prefers the JSON blob when both JSON and DOM are present", () => {
    // Construct a doc where the DOM shows team X winning but the JSON
    // blob says team Y. The JSON path is authoritative.
    const html = `
      <html><body>
        <li class="matchup"><span class="team is-winner" data-team="Brazil"><span class="team-name">Brazil</span></span><span class="team" data-team="France"><span class="team-name">France</span></span></li>
        <script>
          window.__INITIAL_STATE__ = {
            "bracket": {
              "matches": [
                { "id": "X1", "home": "Brazil", "away": "France", "pick": "France" }
              ]
            }
          };
        </script>
      </body></html>
    `;
    const result = parseHtml(html);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].predictedWinnerRaw).toBe("France");
    expect(result.matches[0].sourceMatchId).toBe("X1");
  });

  it("returns empty matches when neither JSON nor DOM yields picks", () => {
    const html = "<html><body>nothing here</body></html>";
    const result = parseHtml(html);
    expect(result.matches).toEqual([]);
    expect(result.championRaw).toBeUndefined();
  });
});
