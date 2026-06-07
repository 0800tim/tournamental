import { describe, expect, it } from "vitest";

import { submitBulkTool } from "../src/tools/submit-bulk.js";
import { decodeMcp, makeClient } from "./helpers.js";

describe("submit_bulk tool", () => {
  it("forwards the submissions list to the bulk endpoint", async () => {
    const apiResponse = {
      accepted: 4,
      dropped_picks: [],
      quota_remaining: { picks_per_hour: 95_000, bots_owned: 12 },
    };
    const { client, calls } = makeClient([
      { method: "POST", path: "/v1/picks/bulk", body: apiResponse },
    ]);

    const res = await submitBulkTool.handler(
      {
        submissions: [
          {
            bot_id: "my-bot-01",
            picks: [
              { match_id: "1", outcome: "home_win" },
              { match_id: "2", outcome: "draw" },
            ],
          },
          {
            bot_id: "my-bot-02",
            picks: [
              { match_id: "1", outcome: "away_win" },
              { match_id: "2", outcome: "home_win" },
            ],
          },
        ],
      },
      client,
    );
    const decoded = decodeMcp(res);

    expect(decoded.isError).toBe(false);
    expect(decoded.payload).toEqual(apiResponse);

    const sent = calls[0]?.body as {
      tournament_id: string;
      submissions: { bot_id: string }[];
    };
    expect(sent.tournament_id).toBe("fifa-wc-2026");
    expect(sent.submissions).toHaveLength(2);
  });
});
