import { describe, expect, it } from "vitest";

import { getMyBotsTool } from "../src/tools/get-my-bots.js";
import { decodeMcp, makeClient } from "./helpers.js";

describe("get_my_bots tool", () => {
  it("returns the caller's bots and quota", async () => {
    const apiResponse = {
      bots: [
        {
          bot_id: "my-bot-01",
          display_name: "Sage Alpha",
          created_at_utc: "2026-05-30T12:00:00Z",
          picks_submitted: 12,
          current_rank: 1483,
          current_points: 6,
        },
      ],
      quota: { bots_owned: 1, bots_quota: 1000 },
    };
    const { client, calls } = makeClient([
      { method: "GET", path: "/v1/bots/me", body: apiResponse },
    ]);

    const res = await getMyBotsTool.handler({}, client);
    const decoded = decodeMcp(res);

    expect(decoded.isError).toBe(false);
    expect(decoded.payload).toEqual(apiResponse);
    expect(calls[0]?.url).toContain("/v1/bots/me");
    expect(calls[0]?.method).toBe("GET");
  });
});
