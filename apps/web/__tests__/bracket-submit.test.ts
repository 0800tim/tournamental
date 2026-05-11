/**
 * Tests for `lib/bracket/submit.ts`, the bracket-submit wrapper that
 * the "Save bracket" CTA on the Final tab calls.
 *
 * Coverage:
 *   - Server-success path returns `status: "submitted"` and the
 *     bracket_id from the server.
 *   - Server 500 / timeout / network-error path returns
 *     `status: "saved_offline"` so the UI can show the offline state
 *     without losing the user's picks.
 *   - The localStorage draft is always written so the user never
 *     loses their picks regardless of network state.
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bracket } from "@vtorn/bracket-engine";

import { submitBracket } from "../lib/bracket/submit";
import { draftKey, loadDraft } from "../lib/bracket/storage";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SAMPLE_BRACKET: Bracket = {
  bracketId: "bk_local_test",
  matchPredictions: {
    "1": {
      matchId: "1",
      outcome: "home_win",
      lockedAt: "2026-06-01T00:00:00.000Z",
    },
  },
  groupTiebreakers: {},
  knockoutPredictions: {},
  version: 1,
};

let originalFetch: typeof fetch | undefined;

beforeEach(() => {
  if (typeof window !== "undefined") window.localStorage.clear();
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  if (originalFetch) globalThis.fetch = originalFetch;
});

describe("submitBracket, server success", () => {
  it("returns status: 'submitted' and writes the server bracketId into the local draft", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        bracket_id: "bk_server_42",
        user_id: "u_1",
        tournament_id: "fifa-wc-2026",
        locked_at: "2026-06-01T00:00:00.000Z",
        version: 1,
      }),
    );
    // Override global fetch since submitBracket() doesn't take a fetchImpl
    // (it's called from a click handler, no DI).
    globalThis.fetch = fetchImpl as unknown as typeof fetch;

    const res = await submitBracket("fifa-wc-2026", SAMPLE_BRACKET, "u_1");
    expect(res.ok).toBe(true);
    expect(res.status).toBe("submitted");
    expect(res.bracket_id).toBe("bk_server_42");

    // localStorage was rewritten with the server bracketId so any
    // subsequent per-match write hits the same row.
    const stored = JSON.parse(
      window.localStorage.getItem(draftKey("fifa-wc-2026", "u_1")) ?? "{}",
    );
    expect(stored.bracketId).toBe("bk_server_42");

    // PUT URL is the canonical game-service one.
    const url = fetchImpl.mock.calls[0]?.[0];
    expect(String(url)).toContain("/v1/bracket/submit");
  });
});

describe("submitBracket, server failure fallback", () => {
  it("returns status: 'saved_offline' on network error and keeps the local draft", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    globalThis.fetch = fetchImpl as unknown as typeof fetch;

    const res = await submitBracket("fifa-wc-2026", SAMPLE_BRACKET, "u_1");
    expect(res.ok).toBe(false);
    expect(res.status).toBe("saved_offline");
    expect(res.error).toBe("network_error");

    // localStorage still has the bracket (saved before the fetch).
    const stored = loadDraft("fifa-wc-2026", "u_1");
    expect(stored).not.toBeNull();
    expect(stored?.matchPredictions["1"]?.outcome).toBe("home_win");
  });

  it("returns status: 'saved_offline' on 503 from the server", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(503, { error: "upstream_down" }));
    globalThis.fetch = fetchImpl as unknown as typeof fetch;

    const res = await submitBracket("fifa-wc-2026", SAMPLE_BRACKET, "u_1");
    expect(res.ok).toBe(false);
    expect(res.status).toBe("saved_offline");
  });

  it("returns status: 'api_error' on 4xx (validation failure)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: "invalid_payload" }));
    globalThis.fetch = fetchImpl as unknown as typeof fetch;

    const res = await submitBracket("fifa-wc-2026", SAMPLE_BRACKET, "u_1");
    expect(res.ok).toBe(false);
    expect(res.status).toBe("api_error");
    expect(res.error).toBe("invalid_payload");
  });
});
