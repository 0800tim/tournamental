/**
 * Unit tests for the FIFA / FIFA+ bracket parser.
 *
 * Covers:
 *   - canParse() across locales (en / es / fr / pt) and host variants
 *   - parse() extracts from the __NEXT_DATA__ JSON when present
 *   - parse() falls back to the DOM scrape when NEXT_DATA is absent
 *   - parse() returns an empty matches array for an empty bracket
 *   - Team-name normalisation round-trips for the raw strings the
 *     parser emits
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fifaParser } from "@/lib/import/parsers/fifa";
import { normaliseTeamName } from "@/lib/import/team-normalise";
import type { Fetcher } from "@/lib/import/types";

/**
 * Local clone of the foundation's `staticFetcher` helper. We can't
 * import it directly from `lib/import/fetcher.ts` because vitest's vite
 * transform statically inspects that module's optional Playwright
 * dynamic-import and fails to resolve it (Playwright isn't a runtime
 * dependency for tests). Matches the foundation contract exactly so
 * production code keeps using the real helper. Same pattern as the
 * sibling Telegraph + BBC parser tests.
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

const FIXTURE_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "lib",
  "import",
  "parsers",
  "__fixtures__",
);

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");
}

describe("fifaParser.canParse", () => {
  it("accepts FIFA+ predictor URLs across locales", () => {
    expect(
      fifaParser.canParse(
        "https://www.fifa.com/fifaplus/en/tournaments/mens/worldcup/canadamexicousa2026/predictor/abc123",
      ),
    ).toBe(true);
    expect(
      fifaParser.canParse(
        "https://www.fifa.com/fifaplus/es/tournaments/mens/worldcup/canadamexicousa2026/predictor/abc123",
      ),
    ).toBe(true);
    expect(
      fifaParser.canParse(
        "https://www.fifa.com/fifaplus/fr/tournaments/mens/worldcup/canadamexicousa2026/predictor/abc123",
      ),
    ).toBe(true);
    expect(
      fifaParser.canParse(
        "https://www.fifa.com/fifaplus/pt/tournaments/mens/worldcup/canadamexicousa2026/predictor/abc123",
      ),
    ).toBe(true);
  });

  it("accepts post-rebrand URLs without the /fifaplus/ segment", () => {
    expect(
      fifaParser.canParse(
        "https://www.fifa.com/en/tournaments/mens/worldcup/2026/predictor/abc123",
      ),
    ).toBe(true);
  });

  it("accepts share + app host variants", () => {
    expect(
      fifaParser.canParse("https://share.fifa.com/predictor/abc123"),
    ).toBe(true);
    expect(
      fifaParser.canParse("https://play.fifa.com/en/predictor/abc123"),
    ).toBe(true);
  });

  it("rejects non-https schemes", () => {
    expect(
      fifaParser.canParse(
        "http://www.fifa.com/en/tournaments/mens/worldcup/2026/predictor/abc",
      ),
    ).toBe(false);
  });

  it("rejects non-FIFA hosts and FIFA pages without a /predictor/ segment", () => {
    expect(
      fifaParser.canParse(
        "https://www.example.com/en/predictor/abc",
      ),
    ).toBe(false);
    expect(
      fifaParser.canParse(
        "https://www.fifa.com/en/tournaments/mens/worldcup/2026/groups",
      ),
    ).toBe(false);
  });

  it("returns false for malformed URLs", () => {
    expect(fifaParser.canParse("not a url at all")).toBe(false);
    expect(fifaParser.canParse("")).toBe(false);
  });
});

describe("fifaParser.parse via NEXT_DATA", () => {
  const url =
    "https://www.fifa.com/fifaplus/en/tournaments/mens/worldcup/canadamexicousa2026/predictor/group-only";

  it("extracts every pick from the JSON-in-script blob", async () => {
    const fetcher = staticFetcher({
      [url]: loadFixture("fifa-group-only.html"),
    });
    const result = await fifaParser.parse(url, fetcher);

    expect(result.matches.length).toBe(4);

    // pickedTeamId === homeTeam.id -> home wins
    expect(result.matches[0]).toMatchObject({
      homeTeamRaw: "Mexico",
      awayTeamRaw: "Canada",
      predictedWinnerRaw: "Mexico",
      sourceMatchId: "wc26-grp-a-mex-can",
      kickoffHint: "2026-06-11T20:00:00Z",
      sourceTimestamp: "2026-05-30T11:14:02Z",
    });

    // pickedTeamId === "draw"
    expect(result.matches[1]).toMatchObject({
      homeTeamRaw: "England",
      awayTeamRaw: "Switzerland",
      predictedWinnerRaw: "draw",
    });

    // prediction.winnerTeamId resolves
    expect(result.matches[2]).toMatchObject({
      homeTeamRaw: "Argentina",
      awayTeamRaw: "Australia",
      predictedWinnerRaw: "Argentina",
    });

    // outcome="away" resolves to the away team name
    expect(result.matches[3]).toMatchObject({
      homeTeamRaw: "France",
      awayTeamRaw: "Norway",
      predictedWinnerRaw: "Norway",
    });
  });

  it("captures the source user handle when exposed", async () => {
    const fetcher = staticFetcher({
      [url]: loadFixture("fifa-group-only.html"),
    });
    const result = await fifaParser.parse(url, fetcher);
    expect(result.sourceUserHandle).toBe("fifa_fan_27");
  });

  it("returns empty matches when the predictor block is empty", async () => {
    const emptyUrl =
      "https://www.fifa.com/fifaplus/en/tournaments/mens/worldcup/canadamexicousa2026/predictor/empty";
    const fetcher = staticFetcher({
      [emptyUrl]: loadFixture("fifa-empty.html"),
    });
    const result = await fifaParser.parse(emptyUrl, fetcher);
    expect(result.matches).toEqual([]);
    expect(result.championRaw).toBeUndefined();
  });

  it("rejects URLs that don't match the FIFA predictor shape", async () => {
    const fetcher = staticFetcher({});
    await expect(
      fifaParser.parse("https://www.example.com/foo", fetcher),
    ).rejects.toThrow(/fifa-url-shape-invalid/);
  });

  it("propagates a fetch failure as a parse failure", async () => {
    const fetcher = staticFetcher({}); // no stubs -> 404
    await expect(
      fifaParser.parse(
        "https://www.fifa.com/en/tournaments/mens/worldcup/2026/predictor/missing",
        fetcher,
      ),
    ).rejects.toThrow(/fifa-fetch-failed/);
  });
});

describe("fifaParser.parse via DOM fallback", () => {
  const url =
    "https://www.fifa.com/fifaplus/es/tournaments/mens/worldcup/canadamexicousa2026/predictor/full";

  it("scrapes match cards when NEXT_DATA is absent", async () => {
    const fetcher = staticFetcher({
      [url]: loadFixture("fifa-full-bracket.html"),
    });
    const result = await fifaParser.parse(url, fetcher);

    expect(result.matches.length).toBe(6);

    // Group stage, home pick highlighted
    expect(result.matches[0]).toMatchObject({
      homeTeamRaw: "México",
      awayTeamRaw: "Canadá",
      predictedWinnerRaw: "México",
      sourceMatchId: "wc26-grp-a-mex-can",
      kickoffHint: "2026-06-11T20:00:00Z",
    });

    // Group stage, draw side highlighted
    expect(result.matches[1]).toMatchObject({
      homeTeamRaw: "Inglaterra",
      awayTeamRaw: "Suiza",
      predictedWinnerRaw: "draw",
    });

    // Knockout, away pick highlighted (semifinal)
    const semi = result.matches.find((m) => m.sourceMatchId === "wc26-sf-1");
    expect(semi).toBeDefined();
    expect(semi).toMatchObject({
      homeTeamRaw: "Argentina",
      awayTeamRaw: "France",
      predictedWinnerRaw: "France",
    });
  });

  it("extracts champion and runner-up from the bracket sections", async () => {
    const fetcher = staticFetcher({
      [url]: loadFixture("fifa-full-bracket.html"),
    });
    const result = await fifaParser.parse(url, fetcher);
    expect(result.championRaw).toBe("France");
    expect(result.runnerUpRaw).toBe("Brazil");
    expect(result.sourceUserHandle).toBe("lalo_predictor");
  });
});

describe("team normalisation against parser output", () => {
  it("normalises every raw team the JSON-path emits", async () => {
    const url =
      "https://www.fifa.com/fifaplus/en/tournaments/mens/worldcup/canadamexicousa2026/predictor/group-only";
    const fetcher = staticFetcher({
      [url]: loadFixture("fifa-group-only.html"),
    });
    const result = await fifaParser.parse(url, fetcher);

    for (const m of result.matches) {
      expect(normaliseTeamName(m.homeTeamRaw)).not.toBeNull();
      expect(normaliseTeamName(m.awayTeamRaw)).not.toBeNull();
      if (m.predictedWinnerRaw !== "draw") {
        expect(normaliseTeamName(m.predictedWinnerRaw)).not.toBeNull();
      }
    }
  });

  it("normalises diacritic-laden Spanish names from the DOM path", async () => {
    const url =
      "https://www.fifa.com/fifaplus/es/tournaments/mens/worldcup/canadamexicousa2026/predictor/full";
    const fetcher = staticFetcher({
      [url]: loadFixture("fifa-full-bracket.html"),
    });
    const result = await fifaParser.parse(url, fetcher);

    // "México" (with diacritic) should normalise to MEX
    expect(normaliseTeamName("México")).toBe("MEX");
    // "Canadá" should normalise to CAN
    expect(normaliseTeamName("Canadá")).toBe("CAN");

    // Champion + runner-up resolve too
    expect(normaliseTeamName(result.championRaw ?? "")).toBe("FRA");
    expect(normaliseTeamName(result.runnerUpRaw ?? "")).toBe("BRA");
  });
});
