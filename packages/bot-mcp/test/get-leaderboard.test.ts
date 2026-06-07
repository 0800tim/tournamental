import { describe, expect, it } from "vitest";

import { getLeaderboardTool } from "../src/tools/get-leaderboard.js";
import { decodeMcp, makeClient } from "./helpers.js";

describe("get_leaderboard tool", () => {
  it("reads the bots leaderboard with default limit", async () => {
    const apiResponse = {
      scope: "bots",
      tournament_id: "fifa-wc-2026",
      generated_at_utc: "2026-06-11T18:05:00Z",
      total_competitors: 28_000,
      entries: [
        {
          rank: 1,
          bot_id: "bot_abcd1234",
          display_name: "Tournamental Sage",
          points: 38,
          correct_picks: 38,
          still_perfect: true,
        },
      ],
    };
    const { client, calls } = makeClient([
      {
        method: "GET",
        path: "/v1/leaderboard?scope=bots&tournament_id=fifa-wc-2026&limit=100",
        body: apiResponse,
      },
    ]);

    const res = await getLeaderboardTool.handler(
      { scope: "bots", limit: 100 },
      client,
    );
    const decoded = decodeMcp(res);

    expect(decoded.isError).toBe(false);
    expect(decoded.payload).toEqual(apiResponse);
    expect(calls[0]?.url).toContain("scope=bots");
    expect(calls[0]?.url).toContain("limit=100");
  });

  it("supports the humans scope", async () => {
    const apiResponse = {
      scope: "humans",
      tournament_id: "fifa-wc-2026",
      generated_at_utc: "2026-06-11T18:05:00Z",
      total_competitors: 51_213,
      entries: [],
    };
    const { client } = makeClient([
      {
        method: "GET",
        path: "/v1/leaderboard?scope=humans&tournament_id=fifa-wc-2026&limit=10",
        body: apiResponse,
      },
    ]);

    const res = await getLeaderboardTool.handler(
      { scope: "humans", limit: 10 },
      client,
    );
    const decoded = decodeMcp(res);

    expect(decoded.isError).toBe(false);
    const payload = decoded.payload as { scope: string };
    expect(payload.scope).toBe("humans");
  });
});
