/**
 * Tests for the Telegraph bracket parser. The parser is described in
 * docs/69-bracket-import.md. Three fixture HTML files live next to the
 * parser at lib/import/parsers/__fixtures__/.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { telegraphParser, parseHtml } from "@/lib/import/parsers/telegraph";
import { normaliseMatchTeams } from "@/lib/import/team-normalise";
import type { Fetcher } from "@/lib/import/types";

/**
 * Local clone of the foundation's `staticFetcher` helper. We can't
 * import it directly from `lib/import/fetcher.ts` because vitest's vite
 * transform statically inspects that module's optional Playwright
 * dynamic-import and fails to resolve it (Playwright isn't a runtime
 * dependency for tests). Matches the foundation contract exactly so
 * production code keeps using the real helper.
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

const FIXTURE_DIR = join(
  __dirname,
  "..",
  "..",
  "lib",
  "import",
  "parsers",
  "__fixtures__",
);

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf8");
}

describe("telegraphParser.canParse", () => {
  it("accepts the 2026 predictor-simulator hub URL", () => {
    expect(
      telegraphParser.canParse(
        "https://www.telegraph.co.uk/football/fifa-world-cup-2026-predictor-simulator/",
      ),
    ).toBe(true);
  });

  it("accepts the predictor-simulator URL with marketing query string", () => {
    expect(
      telegraphParser.canParse(
        "https://www.telegraph.co.uk/football/fifa-world-cup-2026-predictor-simulator/?WT.mc_id=tmgoff_fb_photo",
      ),
    ).toBe(true);
  });

  it("accepts the legacy /football/world-cup/<year>/predictor/ pattern", () => {
    expect(
      telegraphParser.canParse(
        "https://www.telegraph.co.uk/football/world-cup/2022/predictor/",
      ),
    ).toBe(true);
  });

  it("accepts the /sport/football/world-cup/predictor/<slug>/ pattern", () => {
    expect(
      telegraphParser.canParse(
        "https://www.telegraph.co.uk/sport/football/world-cup/predictor/sam-wallace-2026/",
      ),
    ).toBe(true);
  });

  it("accepts the bare predictor share path on www subdomain", () => {
    expect(
      telegraphParser.canParse(
        "https://telegraph.co.uk/football/world-cup-2026-predictor-simulator/",
      ),
    ).toBe(true);
  });

  it("rejects non-Telegraph URLs", () => {
    expect(
      telegraphParser.canParse(
        "https://www.bbc.co.uk/sport/football/world-cup/predictor/abc",
      ),
    ).toBe(false);
    expect(
      telegraphParser.canParse(
        "https://www.espn.com/soccer/bracket/_/tournament/fifa.world",
      ),
    ).toBe(false);
    expect(telegraphParser.canParse("")).toBe(false);
    expect(telegraphParser.canParse("not-a-url")).toBe(false);
  });

  it("rejects Telegraph URLs that don't point at the predictor", () => {
    expect(
      telegraphParser.canParse(
        "https://www.telegraph.co.uk/football/2026/06/11/world-cup-opener-mexico-canada-recap/",
      ),
    ).toBe(false);
    expect(
      telegraphParser.canParse(
        "https://www.telegraph.co.uk/news/2026/06/11/world-cup-opening-ceremony/",
      ),
    ).toBe(false);
  });

  it("refuses http:// URLs even on the right host", () => {
    // canParse is intentionally permissive on scheme (the fetcher
    // enforces https). We deliberately don't accept http here as a
    // belt-and-braces guard.
    expect(
      telegraphParser.canParse(
        "http://www.telegraph.co.uk/football/fifa-world-cup-2026-predictor-simulator/",
      ),
    ).toBe(false);
  });
});

describe("telegraphParser.parse,empty bracket", () => {
  it("returns no picks and no champion when nothing is set", async () => {
    const html = loadFixture("telegraph-empty.html");
    const url = "https://www.telegraph.co.uk/football/fifa-world-cup-2026-predictor-simulator/";
    const fetcher = staticFetcher({ [url]: html });
    const result = await telegraphParser.parse(url, fetcher);
    expect(result.matches).toEqual([]);
    expect(result.championRaw).toBeUndefined();
    expect(result.runnerUpRaw).toBeUndefined();
    expect(result.sourceUserHandle).toBeUndefined();
  });

  it("does not throw on an empty bracket", async () => {
    const html = loadFixture("telegraph-empty.html");
    const url = "https://www.telegraph.co.uk/football/fifa-world-cup-2026-predictor-simulator/";
    const fetcher = staticFetcher({ [url]: html });
    await expect(telegraphParser.parse(url, fetcher)).resolves.toBeTruthy();
  });
});

describe("telegraphParser.parse,group-stage-only bracket", () => {
  it("extracts only the matches the user has set", async () => {
    const html = loadFixture("telegraph-group-stage-only.html");
    const url = "https://www.telegraph.co.uk/football/fifa-world-cup-2026-predictor-simulator/";
    const fetcher = staticFetcher({ [url]: html });
    const result = await telegraphParser.parse(url, fetcher);
    // Group A m1 (Mexico picked) + m2 (Egypt picked) + m3 (draw) +
    // Group B m1 (Argentina picked). Group B m2 has no selection and is
    // dropped, as is the knockout placeholder.
    expect(result.matches).toHaveLength(4);
    expect(result.championRaw).toBeUndefined();
    expect(result.runnerUpRaw).toBeUndefined();
    expect(result.sourceUserHandle).toBe("Sam Wallace");
  });

  it("identifies the picked winner side correctly", async () => {
    const html = loadFixture("telegraph-group-stage-only.html");
    const url = "https://www.telegraph.co.uk/football/fifa-world-cup-2026-predictor-simulator/";
    const fetcher = staticFetcher({ [url]: html });
    const result = await telegraphParser.parse(url, fetcher);
    const m1 = result.matches.find((m) => m.sourceMatchId === "grpA-m1");
    expect(m1).toMatchObject({
      homeTeamRaw: "Mexico",
      awayTeamRaw: "Canada",
      predictedWinnerRaw: "Mexico",
    });
    const m2 = result.matches.find((m) => m.sourceMatchId === "grpA-m2");
    expect(m2).toMatchObject({
      homeTeamRaw: "USA",
      awayTeamRaw: "Egypt",
      predictedWinnerRaw: "Egypt",
    });
  });

  it("represents a group-stage draw with predictedWinnerRaw='draw'", async () => {
    const html = loadFixture("telegraph-group-stage-only.html");
    const url = "https://www.telegraph.co.uk/football/fifa-world-cup-2026-predictor-simulator/";
    const fetcher = staticFetcher({ [url]: html });
    const result = await telegraphParser.parse(url, fetcher);
    const drawMatch = result.matches.find((m) => m.sourceMatchId === "grpA-m3");
    expect(drawMatch).toMatchObject({
      homeTeamRaw: "Mexico",
      awayTeamRaw: "USA",
      predictedWinnerRaw: "draw",
    });
  });

  it("carries the kickoff hint through when present in the DOM", async () => {
    const html = loadFixture("telegraph-group-stage-only.html");
    const url = "https://www.telegraph.co.uk/football/fifa-world-cup-2026-predictor-simulator/";
    const fetcher = staticFetcher({ [url]: html });
    const result = await telegraphParser.parse(url, fetcher);
    const m1 = result.matches.find((m) => m.sourceMatchId === "grpA-m1");
    expect(m1?.kickoffHint).toBe("2026-06-11T20:00:00Z");
  });
});

describe("telegraphParser.parse,knockout-filled bracket", () => {
  it("extracts every filled match across group + knockouts", async () => {
    const html = loadFixture("telegraph-knockout-filled.html");
    const url = "https://www.telegraph.co.uk/football/fifa-world-cup-2026-predictor-simulator/";
    const fetcher = staticFetcher({ [url]: html });
    const result = await telegraphParser.parse(url, fetcher);
    // grpA-m1 + grpC-m1 + ro16-1 + ro16-2 + qf-1 + sf-1 + fin-1.
    expect(result.matches).toHaveLength(7);
  });

  it("supports the data-winner attribute style of marking the pick", async () => {
    const html = loadFixture("telegraph-knockout-filled.html");
    const url = "https://www.telegraph.co.uk/football/fifa-world-cup-2026-predictor-simulator/";
    const fetcher = staticFetcher({ [url]: html });
    const result = await telegraphParser.parse(url, fetcher);
    const qf = result.matches.find((m) => m.sourceMatchId === "qf-1");
    expect(qf).toMatchObject({
      homeTeamRaw: "Argentina",
      awayTeamRaw: "USA",
      predictedWinnerRaw: "Argentina",
    });
  });

  it("supports the advance-ribbon style of marking the pick", async () => {
    const html = loadFixture("telegraph-knockout-filled.html");
    const url = "https://www.telegraph.co.uk/football/fifa-world-cup-2026-predictor-simulator/";
    const fetcher = staticFetcher({ [url]: html });
    const result = await telegraphParser.parse(url, fetcher);
    const sf = result.matches.find((m) => m.sourceMatchId === "sf-1");
    expect(sf?.predictedWinnerRaw).toBe("Argentina");
  });

  it("exposes the champion + runner up from the bracket footer", async () => {
    const html = loadFixture("telegraph-knockout-filled.html");
    const url = "https://www.telegraph.co.uk/football/fifa-world-cup-2026-predictor-simulator/";
    const fetcher = staticFetcher({ [url]: html });
    const result = await telegraphParser.parse(url, fetcher);
    expect(result.championRaw).toBe("Argentina");
    expect(result.runnerUpRaw).toBe("Brazil");
    expect(result.sourceUserHandle).toBe("Jamie Carragher");
  });

  it("normalises raw team names end-to-end via normaliseMatchTeams", async () => {
    const html = loadFixture("telegraph-knockout-filled.html");
    const url = "https://www.telegraph.co.uk/football/fifa-world-cup-2026-predictor-simulator/";
    const fetcher = staticFetcher({ [url]: html });
    const result = await telegraphParser.parse(url, fetcher);
    const ro16 = result.matches.find((m) => m.sourceMatchId === "ro16-2");
    expect(ro16).toBeTruthy();
    const normalised = normaliseMatchTeams({
      homeTeamRaw: ro16!.homeTeamRaw,
      awayTeamRaw: ro16!.awayTeamRaw,
      predictedWinnerRaw: ro16!.predictedWinnerRaw,
    });
    expect(normalised).toEqual({
      home: "NED",
      away: "USA",
      outcome: "away_win",
    });
  });
});

describe("telegraphParser.parse,JSON-island override", () => {
  it("prefers the embedded predictor state when present", async () => {
    const url = "https://www.telegraph.co.uk/football/fifa-world-cup-2026-predictor-simulator/";
    const json = JSON.stringify({
      user: "JSON User",
      picks: [
        {
          matchId: "grpA-m1",
          home: "Mexico",
          away: "Canada",
          winner: "Canada",
          kickoff: "2026-06-11T20:00:00Z",
        },
        {
          matchId: "grpA-m2",
          home: "USA",
          away: "Egypt",
          winner: "draw",
        },
      ],
      champion: "France",
      runnerUp: "Brazil",
    });
    // Wrap the JSON in a script tag, plus include the DOM bracket that
    // says something different. The JSON should win.
    const html = `
      <html><body>
        <script type="application/json" data-predictor-state>${json}</script>
        <div class="bracket-predictor" data-user-handle="DOM User">
          <article class="bracket-predictor__match" data-match-id="grpA-m1">
            <div class="bracket-predictor__team bracket-predictor__team--home bracket-predictor__team--selected" data-team="Mexico">Mexico</div>
            <div class="bracket-predictor__team bracket-predictor__team--away" data-team="Canada">Canada</div>
          </article>
        </div>
      </body></html>`;
    const fetcher = staticFetcher({ [url]: html });
    const result = await telegraphParser.parse(url, fetcher);
    expect(result.sourceUserHandle).toBe("JSON User");
    expect(result.championRaw).toBe("France");
    expect(result.runnerUpRaw).toBe("Brazil");
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]).toMatchObject({
      homeTeamRaw: "Mexico",
      awayTeamRaw: "Canada",
      predictedWinnerRaw: "Canada",
    });
    expect(result.matches[1].predictedWinnerRaw).toBe("draw");
  });

  it("falls back to the DOM when JSON-island is malformed", () => {
    const html = `<script type="application/json" data-predictor-state>not-json{</script>
      <div class="bracket-predictor">
        <article class="bracket-predictor__match" data-match-id="m1">
          <div class="bracket-predictor__team bracket-predictor__team--home bracket-predictor__team--selected" data-team="France">France</div>
          <div class="bracket-predictor__team bracket-predictor__team--away" data-team="Spain">Spain</div>
        </article>
      </div>`;
    const result = parseHtml(html);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      homeTeamRaw: "France",
      awayTeamRaw: "Spain",
      predictedWinnerRaw: "France",
    });
  });
});

describe("telegraphParser.parse,failure modes", () => {
  it("throws when the fetcher fails", async () => {
    const url = "https://www.telegraph.co.uk/football/fifa-world-cup-2026-predictor-simulator/";
    // Mismatched prefix forces the static fetcher to return ok=false.
    const fetcher = staticFetcher({ "https://example.invalid/": "" });
    await expect(telegraphParser.parse(url, fetcher)).rejects.toThrow(
      /telegraph-fetch-failed/,
    );
  });

  it("returns an empty result when the HTML has no bracket markup", () => {
    const result = parseHtml("<html><body><p>nothing to see</p></body></html>");
    expect(result.matches).toEqual([]);
    expect(result.championRaw).toBeUndefined();
  });
});
