/**
 * Tests for the WC2026 fixture-fetch script.
 *
 * Covers:
 *   - normalise() rejects malformed payloads.
 *   - normalise() splits group vs knockout matches by match_no + knockout_id.
 *   - spliceFixtures() updates kickoffs in-place without dropping unrelated fixtures.
 *   - runFetch() with a mocked fetch + mocked filesystem produces a deterministic write.
 *   - The vendored bracket-engine fixtures JSON has a parseable ISO kickoff_utc on
 *     every group fixture (smoke check the ground truth file ships clean).
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  isIsoUtc,
  normalise,
  spliceFixtures,
  stableStringify,
  runFetch,
} from "./fetch-fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = resolve(
  here,
  "..",
  "..",
  "..",
  "packages",
  "bracket-engine",
  "data",
  "fifa-wc-2026-fixtures.json",
);

describe("fetch-fixtures / isIsoUtc", () => {
  it("accepts valid ISO-8601 UTC timestamps", () => {
    expect(isIsoUtc("2026-06-11T19:00:00Z")).toBe(true);
    expect(isIsoUtc("2026-06-11T19:00:00.123Z")).toBe(true);
  });
  it("rejects invalid or non-UTC timestamps", () => {
    expect(isIsoUtc("")).toBe(false);
    expect(isIsoUtc("2026-06-11")).toBe(false);
    expect(isIsoUtc("2026-06-11T19:00:00+01:00")).toBe(false);
    expect(isIsoUtc(undefined)).toBe(false);
    expect(isIsoUtc(123)).toBe(false);
  });
});

describe("fetch-fixtures / normalise", () => {
  it("splits group vs knockout matches", () => {
    const out = normalise({
      matches: [
        { match_no: 1, group_id: "A", kickoff_utc: "2026-06-11T19:00:00Z" },
        { match_no: 73, knockout_id: "r32_01", kickoff_utc: "2026-06-30T20:00:00Z" },
      ],
    });
    expect(out.groups["1"]).toEqual({ kickoff_utc: "2026-06-11T19:00:00Z" });
    expect(out.knockouts["r32_01"]).toEqual({
      kickoff_utc: "2026-06-30T20:00:00Z",
    });
  });

  it("preserves optional venue + host fields when present", () => {
    const out = normalise({
      matches: [
        {
          match_no: 1,
          group_id: "A",
          kickoff_utc: "2026-06-11T19:00:00Z",
          venue: "Estadio Azteca",
          host: "MX",
        },
      ],
    });
    expect(out.groups["1"]).toEqual({
      kickoff_utc: "2026-06-11T19:00:00Z",
      venue: "Estadio Azteca",
      host: "MX",
    });
  });

  it("throws on a missing matches array", () => {
    expect(() => normalise({} as unknown as Parameters<typeof normalise>[0])).toThrow(
      /missing/i,
    );
  });

  it("throws on a missing match_no", () => {
    expect(() =>
      normalise({
        matches: [{ kickoff_utc: "2026-06-11T19:00:00Z" } as unknown as never],
      }),
    ).toThrow(/match_no/);
  });

  it("throws on an invalid kickoff_utc", () => {
    expect(() =>
      normalise({
        matches: [
          { match_no: 1, group_id: "A", kickoff_utc: "tomorrow at 7pm" },
        ],
      }),
    ).toThrow(/kickoff_utc/);
  });

  it("throws when match_no > 72 has no knockout_id", () => {
    expect(() =>
      normalise({
        matches: [{ match_no: 88, kickoff_utc: "2026-07-01T20:00:00Z" }],
      }),
    ).toThrow(/knockout_id/);
  });
});

describe("fetch-fixtures / spliceFixtures", () => {
  it("updates only matched fixtures, preserving the rest", () => {
    const existing = {
      _meta: { schedule_status: "official", fetched_at_utc: "2026-01-01T00:00:00Z" },
      group_fixtures: [
        { match_no: 1, kickoff_utc: "2026-06-11T19:00:00Z", venue: "OldA" },
        { match_no: 2, kickoff_utc: "2026-06-12T22:00:00Z", venue: "OldB" },
      ],
      knockouts: [
        { id: "r32_01", kickoff_utc: "2026-06-30T20:00:00Z", venue: "KOldA" },
      ],
    };
    const feed = {
      groups: {
        "1": { kickoff_utc: "2026-06-11T20:00:00Z", venue: "NewA" },
      },
      knockouts: {},
    };
    const next = spliceFixtures(existing, feed, "2026-05-10T00:00:00Z");
    expect(next.group_fixtures[0]).toMatchObject({
      match_no: 1,
      kickoff_utc: "2026-06-11T20:00:00Z",
      venue: "NewA",
    });
    expect(next.group_fixtures[1]).toMatchObject({
      match_no: 2,
      kickoff_utc: "2026-06-12T22:00:00Z",
      venue: "OldB",
    });
    expect(next.knockouts[0]).toMatchObject({
      id: "r32_01",
      kickoff_utc: "2026-06-30T20:00:00Z",
    });
    expect(next._meta.fetched_at_utc).toBe("2026-05-10T00:00:00Z");
  });
});

describe("fetch-fixtures / stableStringify", () => {
  it("emits sorted keys with trailing newline", () => {
    const out = stableStringify({ b: 1, a: 2 });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.indexOf('"a"')).toBeLessThan(out.indexOf('"b"'));
  });
});

describe("fetch-fixtures / runFetch (mocked)", () => {
  it("fetches, normalises, splices, and writes the output", async () => {
    const upstream = {
      matches: [
        { match_no: 1, group_id: "A", kickoff_utc: "2026-06-11T20:30:00Z" },
      ],
    };
    const existing = {
      _meta: { schedule_status: "official", fetched_at_utc: "2026-01-01T00:00:00Z" },
      group_fixtures: [{ match_no: 1, kickoff_utc: "2026-06-11T19:00:00Z" }],
      knockouts: [],
    };
    const writes: Array<{ path: string; body: string }> = [];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => upstream,
    });
    const result = await runFetch({
      sourceUrl: "https://example.test/fixtures",
      outPath: "/tmp/out.json",
      deps: {
        fetch: fetchMock as unknown as typeof globalThis.fetch,
        readFile: () => JSON.stringify(existing),
        writeFile: (p, b) => writes.push({ path: p, body: b }),
        now: () => new Date("2026-05-10T00:00:00Z"),
      },
    });
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/fixtures");
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("/tmp/out.json");
    expect(writes[0].body.endsWith("\n")).toBe(true);
    expect(result.doc.group_fixtures[0].kickoff_utc).toBe("2026-06-11T20:30:00Z");
  });

  it("--dry-run does not write", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        matches: [
          { match_no: 1, group_id: "A", kickoff_utc: "2026-06-11T20:30:00Z" },
        ],
      }),
    });
    const writes: Array<unknown> = [];
    const result = await runFetch({
      sourceUrl: "https://example.test/fixtures",
      outPath: "/tmp/out.json",
      dryRun: true,
      deps: {
        fetch: fetchMock as unknown as typeof globalThis.fetch,
        readFile: () =>
          JSON.stringify({
            _meta: {},
            group_fixtures: [
              { match_no: 1, kickoff_utc: "2026-06-11T19:00:00Z" },
            ],
            knockouts: [],
          }),
        writeFile: (p, b) => writes.push({ p, b }),
        now: () => new Date("2026-05-10T00:00:00Z"),
      },
    });
    expect(result.writtenPath).toBeNull();
    expect(writes).toHaveLength(0);
  });

  it("throws on non-OK upstream response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: async () => ({}),
    });
    await expect(
      runFetch({
        sourceUrl: "https://example.test/fixtures",
        outPath: "/tmp/out.json",
        deps: {
          fetch: fetchMock as unknown as typeof globalThis.fetch,
          readFile: () => "{}",
          writeFile: () => {},
          now: () => new Date(),
        },
      }),
    ).rejects.toThrow(/HTTP 503/);
  });
});

describe("fetch-fixtures / vendored fixtures sanity", () => {
  it("every group fixture has a parseable ISO kickoff_utc", () => {
    const raw = readFileSync(FIXTURES_PATH, "utf-8");
    const doc = JSON.parse(raw) as {
      group_fixtures: Array<{ match_no: number; kickoff_utc: unknown }>;
      knockouts: Array<{ id: string; kickoff_utc: unknown }>;
    };
    expect(doc.group_fixtures.length).toBeGreaterThan(0);
    for (const f of doc.group_fixtures) {
      expect(
        isIsoUtc(f.kickoff_utc),
        `match ${f.match_no} kickoff_utc=${String(f.kickoff_utc)}`,
      ).toBe(true);
      expect(Number.isFinite(Date.parse(f.kickoff_utc as string))).toBe(true);
    }
  });

  it("every knockout fixture has a parseable ISO kickoff_utc", () => {
    const raw = readFileSync(FIXTURES_PATH, "utf-8");
    const doc = JSON.parse(raw) as {
      knockouts: Array<{ id: string; kickoff_utc: unknown }>;
    };
    for (const k of doc.knockouts) {
      expect(
        isIsoUtc(k.kickoff_utc),
        `knockout ${k.id} kickoff_utc=${String(k.kickoff_utc)}`,
      ).toBe(true);
    }
  });
});
