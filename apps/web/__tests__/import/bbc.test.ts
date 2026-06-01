/**
 * Unit tests for the BBC Sport "World Cup Predictor" parser.
 *
 * Covers:
 *   - URL-shape recognition (canParse) across .com + .co.uk hosts,
 *     tournament path variants, and rejection of non-BBC URLs.
 *   - Group-only fixture: produces the right team-pair + outcome for
 *     home / away / draw picks, including HTML-entity decoding.
 *   - Full-bracket fixture: knockout picks, champion, runner-up,
 *     share-handle, and kickoff hints + source match ids.
 *   - Empty fixture: parser returns an empty matches array (not
 *     throws) when the user has no picks yet.
 *   - Hard failure when the page is missing the predictor container.
 *   - Hard failure when the fetcher itself fails.
 *   - Compatibility with `normaliseTeamName` so the wizard's
 *     downstream mapping resolves every raw team string in the
 *     full-bracket fixture.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { bbcParser } from "@/lib/import/parsers/bbc";
import { normaliseTeamName } from "@/lib/import/team-normalise";
import type { Fetcher } from "@/lib/import/types";

/**
 * Local clone of the foundation's `staticFetcher` helper. We can't
 * import the real one from `lib/import/fetcher.ts` here because vitest's
 * vite transform statically inspects that module's optional Playwright
 * dynamic-import and fails to resolve it (Playwright isn't a runtime
 * dep). The contract is small enough to redeclare in test scope, and
 * the production import code path still uses the real foundation
 * fetcher in lib/. If foundation ever splits the test helper into its
 * own file, this can collapse back to a single-line import.
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
  return readFileSync(path.join(FIXTURE_DIR, name), "utf8");
}

const SAMPLE_URL =
  "https://www.bbc.co.uk/sport/football/world-cup/predictor/ab12cd34ef56";

describe("bbcParser.canParse", () => {
  it("accepts .co.uk world-cup predictor share URLs", () => {
    expect(bbcParser.canParse(SAMPLE_URL)).toBe(true);
  });

  it("accepts .com world-cup predictor share URLs", () => {
    expect(
      bbcParser.canParse(
        "https://www.bbc.com/sport/football/world-cup/predictor/01HXYZ123456",
      ),
    ).toBe(true);
  });

  it("accepts tournament-suffixed slug paths", () => {
    expect(
      bbcParser.canParse(
        "https://www.bbc.co.uk/sport/football/world-cup-2026/predictor/abc123",
      ),
    ).toBe(true);
  });

  it("accepts /predictor/share/<id> variant", () => {
    expect(
      bbcParser.canParse(
        "https://www.bbc.co.uk/sport/football/euro-2024/predictor/share/xyz789",
      ),
    ).toBe(true);
  });

  it("accepts URLs with trailing slash + query string", () => {
    expect(
      bbcParser.canParse(
        "https://www.bbc.co.uk/sport/football/world-cup/predictor/abc123/?src=twitter",
      ),
    ).toBe(true);
  });

  it("rejects non-BBC URLs", () => {
    expect(
      bbcParser.canParse(
        "https://www.telegraph.co.uk/world-cup/predictor/abc123",
      ),
    ).toBe(false);
    expect(
      bbcParser.canParse("https://www.fifa.com/predictor/share/abc123"),
    ).toBe(false);
    expect(bbcParser.canParse("https://example.com")).toBe(false);
  });

  it("rejects http:// (non-https) BBC URLs", () => {
    expect(
      bbcParser.canParse(
        "http://www.bbc.co.uk/sport/football/world-cup/predictor/abc123",
      ),
    ).toBe(false);
  });

  it("rejects BBC URLs that aren't predictor share links", () => {
    expect(
      bbcParser.canParse(
        "https://www.bbc.co.uk/sport/football/world-cup/scores-fixtures",
      ),
    ).toBe(false);
    expect(
      bbcParser.canParse("https://www.bbc.co.uk/news/uk-12345"),
    ).toBe(false);
  });

  it("returns false for empty + non-string inputs", () => {
    expect(bbcParser.canParse("")).toBe(false);
    // @ts-expect-error - intentional misuse guard.
    expect(bbcParser.canParse(null)).toBe(false);
    // @ts-expect-error - intentional misuse guard.
    expect(bbcParser.canParse(undefined)).toBe(false);
  });
});

describe("bbcParser.parse - group-only fixture", () => {
  it("extracts every group-stage pick with the right outcome", async () => {
    const html = loadFixture("bbc-group-only.html");
    const fetcher = staticFetcher({ [SAMPLE_URL]: html });
    const result = await bbcParser.parse(SAMPLE_URL, fetcher);

    expect(result.matches).toHaveLength(5);

    const [mexNzl, argGer, fraBra, korSen, civEsp] = result.matches;

    expect(mexNzl.homeTeamRaw).toBe("Mexico");
    expect(mexNzl.awayTeamRaw).toBe("New Zealand");
    expect(mexNzl.predictedWinnerRaw).toBe("Mexico");
    expect(mexNzl.sourceMatchId).toBe("grp-a-01");
    expect(mexNzl.kickoffHint).toBe("2026-06-11T20:00:00Z");

    expect(argGer.predictedWinnerRaw).toBe("Germany");
    expect(fraBra.predictedWinnerRaw).toBe("draw");
    expect(korSen.predictedWinnerRaw).toBe("Senegal");

    // Entity-decoded team name: "Cote d'Ivoire" comes through as
    // "Côte d'Ivoire" once we decode &ocirc; + &#39;.
    expect(civEsp.homeTeamRaw).toBe("Côte d'Ivoire");
    expect(civEsp.predictedWinnerRaw).toBe("Spain");
  });

  it("captures the share handle but no champion when only group picks exist", async () => {
    const html = loadFixture("bbc-group-only.html");
    const fetcher = staticFetcher({ [SAMPLE_URL]: html });
    const result = await bbcParser.parse(SAMPLE_URL, fetcher);

    expect(result.sourceUserHandle).toBe("joebloggs");
    expect(result.championRaw).toBeUndefined();
    expect(result.runnerUpRaw).toBeUndefined();
  });

  it("every raw team name in the group fixture resolves via normaliseTeamName", async () => {
    const html = loadFixture("bbc-group-only.html");
    const fetcher = staticFetcher({ [SAMPLE_URL]: html });
    const result = await bbcParser.parse(SAMPLE_URL, fetcher);
    for (const pick of result.matches) {
      expect(normaliseTeamName(pick.homeTeamRaw)).not.toBeNull();
      expect(normaliseTeamName(pick.awayTeamRaw)).not.toBeNull();
      if (pick.predictedWinnerRaw !== "draw") {
        expect(normaliseTeamName(pick.predictedWinnerRaw)).not.toBeNull();
      }
    }
  });
});

describe("bbcParser.parse - full-bracket fixture", () => {
  it("returns every fixture from group to final + the champion + runner-up", async () => {
    const html = loadFixture("bbc-full-bracket.html");
    const fetcher = staticFetcher({ [SAMPLE_URL]: html });
    const result = await bbcParser.parse(SAMPLE_URL, fetcher);

    // 2 group + 2 R16 + 1 QF + 1 SF + 1 final = 7.
    expect(result.matches).toHaveLength(7);
    expect(result.championRaw).toBe("Argentina");
    expect(result.runnerUpRaw).toBe("Netherlands");
    expect(result.sourceUserHandle).toBe("predictor_pro");
  });

  it("knockout fixtures expose source match ids + kickoff hints", async () => {
    const html = loadFixture("bbc-full-bracket.html");
    const fetcher = staticFetcher({ [SAMPLE_URL]: html });
    const result = await bbcParser.parse(SAMPLE_URL, fetcher);

    const final = result.matches.find((m) => m.sourceMatchId === "final-01");
    expect(final).toBeDefined();
    expect(final?.homeTeamRaw).toBe("Argentina");
    expect(final?.awayTeamRaw).toBe("Netherlands");
    expect(final?.predictedWinnerRaw).toBe("Argentina");
    expect(final?.kickoffHint).toBe("2026-07-19T19:00:00Z");
  });

  it("preserves a group-stage draw alongside knockout home/away picks", async () => {
    const html = loadFixture("bbc-full-bracket.html");
    const fetcher = staticFetcher({ [SAMPLE_URL]: html });
    const result = await bbcParser.parse(SAMPLE_URL, fetcher);
    const draw = result.matches.find(
      (m) => m.homeTeamRaw === "Brazil" && m.awayTeamRaw === "Portugal",
    );
    expect(draw?.predictedWinnerRaw).toBe("draw");
  });

  it("champion + runner-up resolve to canonical team codes", async () => {
    const html = loadFixture("bbc-full-bracket.html");
    const fetcher = staticFetcher({ [SAMPLE_URL]: html });
    const result = await bbcParser.parse(SAMPLE_URL, fetcher);
    expect(normaliseTeamName(result.championRaw ?? "")).toBe("ARG");
    expect(normaliseTeamName(result.runnerUpRaw ?? "")).toBe("NED");
  });
});

describe("bbcParser.parse - empty fixture", () => {
  it("returns an empty matches array (not an error) when the user has no picks", async () => {
    const html = loadFixture("bbc-empty.html");
    const fetcher = staticFetcher({ [SAMPLE_URL]: html });
    const result = await bbcParser.parse(SAMPLE_URL, fetcher);
    expect(result.matches).toEqual([]);
    expect(result.championRaw).toBeUndefined();
    expect(result.runnerUpRaw).toBeUndefined();
    expect(result.sourceUserHandle).toBeUndefined();
  });
});

describe("bbcParser.parse - error paths", () => {
  it("throws when the fetcher reports a network error", async () => {
    const failingFetcher: Fetcher = {
      async fetch() {
        return { ok: false, status: 0, error: "timeout" };
      },
    };
    await expect(bbcParser.parse(SAMPLE_URL, failingFetcher)).rejects.toThrow(
      /bbc-fetch-failed/,
    );
  });

  it("throws when the fetched HTML isn't a predictor page", async () => {
    const fetcher = staticFetcher({
      [SAMPLE_URL]: "<html><body><h1>Not a predictor</h1></body></html>",
    });
    await expect(bbcParser.parse(SAMPLE_URL, fetcher)).rejects.toThrow(
      /bbc-not-predictor-page/,
    );
  });

  it("skips fixture rows missing required pieces rather than throwing", async () => {
    const partial = `
      <main>
        <section data-testid="predictor-bracket" class="qa-predictor">
          <div class="qa-fixture" data-fixture-id="ok">
            <span class="qa-fixture__team qa-fixture__team--home">Argentina</span>
            <span class="qa-fixture__team qa-fixture__team--away">France</span>
            <span class="qa-fixture__pick" data-picked="home">Argentina</span>
          </div>
          <div class="qa-fixture" data-fixture-id="no-pick-yet">
            <span class="qa-fixture__team qa-fixture__team--home">Brazil</span>
            <span class="qa-fixture__team qa-fixture__team--away">Spain</span>
          </div>
        </section>
      </main>`;
    const fetcher = staticFetcher({ [SAMPLE_URL]: partial });
    const result = await bbcParser.parse(SAMPLE_URL, fetcher);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].sourceMatchId).toBe("ok");
  });
});
