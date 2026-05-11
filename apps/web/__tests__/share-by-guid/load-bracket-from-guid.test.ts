/**
 * Tests for the real-network `loadBracketFromGuid` flow.
 *
 * Covers the launch-blocking bug:
 *   - successful upstream response normalises into a BracketByGuid
 *     with the champion code lifted into a TeamLite from teams.json
 *     (so the share-landing page shows the user's REAL bracket)
 *   - 404 from upstream → null (renders the not_found view)
 *   - 5xx from upstream → null
 *   - aborted fetch (timeout) → null
 *   - non-matching guid shape → null without firing fetch
 */

// @vitest-environment node

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  loadBracketFromGuid,
  __unsafe_clear_bracket_registry_for_tests,
} from "@/lib/bracket/by-guid";

beforeEach(() => {
  __unsafe_clear_bracket_registry_for_tests();
});

function mockFetch(response: {
  status?: number;
  body?: unknown;
  ok?: boolean;
}): typeof fetch {
  const status = response.status ?? 200;
  const ok = response.ok ?? (status >= 200 && status < 300);
  return (async () =>
    ({
      ok,
      status,
      json: async () => response.body,
    }) as unknown as Response) as typeof fetch;
}

describe("loadBracketFromGuid", () => {
  it("returns a normalised BracketByGuid on a successful upstream response", async () => {
    const fetchImpl = mockFetch({
      status: 200,
      body: {
        ok: true,
        bracket: {
          share_guid: "d64a707a-9af2-4c1a-8661-45f69bd52160",
          user_handle: null,
          tournament_id: "fifa-wc-2026",
          champion_code: "ARG",
          runner_up_code: "FRA",
          third_place_code: "BRA",
          knockout_path: [
            { stage: "r16", opponent_code: "AUS", result: "win" },
            { stage: "qf", opponent_code: "NED", result: "win" },
            { stage: "sf", opponent_code: "CRO", result: "win" },
            { stage: "final", opponent_code: "FRA", result: "win" },
          ],
          locked_at: "2026-05-11T12:00:00Z",
        },
      },
    });

    const result = await loadBracketFromGuid(
      "d64a707a-9af2-4c1a-8661-45f69bd52160",
      { fetchImpl, baseUrl: "http://test" },
    );
    expect(result).not.toBeNull();
    expect(result?.champion.code).toBe("ARG");
    expect(result?.champion.name).toBe("Argentina");
    expect(result?.runner_up.code).toBe("FRA");
    expect(result?.path_to_gold.length).toBe(4);
    expect(result?.path_to_gold[3]?.stage).toBe("final");
    expect(result?.handle).toBe("Anonymous");
    expect(result?.tournament_label).toBe("FIFA World Cup 2026");
  });

  it("returns null when upstream responds 404", async () => {
    const fetchImpl = mockFetch({
      status: 404,
      body: { ok: false, error: "not_found" },
    });
    const result = await loadBracketFromGuid(
      "00000000-0000-4000-8000-000000000000",
      { fetchImpl, baseUrl: "http://test" },
    );
    expect(result).toBeNull();
  });

  it("returns null when upstream responds 500", async () => {
    const fetchImpl = mockFetch({
      status: 500,
      body: { ok: false, error: "internal" },
    });
    const result = await loadBracketFromGuid(
      "00000000-0000-4000-8000-000000000001",
      { fetchImpl, baseUrl: "http://test" },
    );
    expect(result).toBeNull();
  });

  it("returns null when the guid shape is invalid (no fetch fired)", async () => {
    const fetchSpy = vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response,
    ) as unknown as typeof fetch;
    const result = await loadBracketFromGuid("hello world!!", {
      fetchImpl: fetchSpy,
      baseUrl: "http://test",
    });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when fetch throws (network error)", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const result = await loadBracketFromGuid(
      "11111111-1111-4111-8111-111111111111",
      { fetchImpl, baseUrl: "http://test" },
    );
    expect(result).toBeNull();
  });
});
