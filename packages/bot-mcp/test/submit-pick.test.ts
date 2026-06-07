import { describe, expect, it } from "vitest";

import { submitPickTool } from "../src/tools/submit-pick.js";
import { decodeMcp, makeClient } from "./helpers.js";

describe("submit_pick tool", () => {
  it("posts a single-pick bulk payload and returns the response", async () => {
    const apiResponse = {
      accepted: 1,
      dropped_picks: [],
      quota_remaining: { picks_per_hour: 99_999, bots_owned: 5 },
    };
    const { client, calls } = makeClient([
      { method: "POST", path: "/v1/picks/bulk", body: apiResponse },
    ]);

    const res = await submitPickTool.handler(
      {
        bot_id: "my-bot-01",
        match_id: "23",
        outcome: "home_win",
      },
      client,
    );
    const decoded = decodeMcp(res);

    expect(decoded.isError).toBe(false);
    expect(decoded.payload).toEqual(apiResponse);
    expect(calls).toHaveLength(1);

    const sent = calls[0]?.body as {
      tournament_id: string;
      submissions: { bot_id: string; picks: { match_id: string; outcome: string }[] }[];
    };
    expect(sent.tournament_id).toBe("fifa-wc-2026");
    expect(sent.submissions).toHaveLength(1);
    expect(sent.submissions[0]?.bot_id).toBe("my-bot-01");
    expect(sent.submissions[0]?.picks).toEqual([
      { match_id: "23", outcome: "home_win" },
    ]);
  });

  it("reports dropped picks from the server in the MCP response", async () => {
    const apiResponse = {
      accepted: 0,
      dropped_picks: [
        { bot_id: "my-bot-01", match_id: "1", reason: "kickoff_passed" },
      ],
      quota_remaining: { picks_per_hour: 100_000, bots_owned: 5 },
    };
    const { client } = makeClient([
      { method: "POST", path: "/v1/picks/bulk", body: apiResponse },
    ]);

    const res = await submitPickTool.handler(
      { bot_id: "my-bot-01", match_id: "1", outcome: "draw" },
      client,
    );
    const decoded = decodeMcp(res);

    expect(decoded.isError).toBe(false);
    const payload = decoded.payload as typeof apiResponse;
    expect(payload.dropped_picks[0]?.reason).toBe("kickoff_passed");
  });
});
