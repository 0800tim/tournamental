import { describe, expect, it } from "vitest";

import { getOddsTool } from "../src/tools/get-odds.js";
import { decodeMcp, makeClient } from "./helpers.js";

describe("get_odds tool", () => {
  it("returns the odds snapshot for a match", async () => {
    const snapshot = {
      match_id: "1",
      home_win: 0.42,
      draw: 0.28,
      away_win: 0.3,
      source: "polymarket",
    };
    const { client, calls } = makeClient([
      { method: "GET", path: "/v1/matches/1/odds", body: snapshot },
    ]);

    const res = await getOddsTool.handler({ match_id: "1" }, client);
    const decoded = decodeMcp(res);

    expect(decoded.isError).toBe(false);
    expect(decoded.payload).toEqual(snapshot);
    expect(calls[0]?.url).toContain("/v1/matches/1/odds");
  });

  it("surfaces API errors thrown by the SDK with status + body", async () => {
    const { client } = makeClient([
      {
        method: "GET",
        path: "/v1/matches/bogus/odds",
        status: 404,
        body: { error: "match not found" },
      },
    ]);

    // The raw handler propagates the error; the registerTool wrapper is
    // responsible for converting that throw into an MCP `isError` response
    // (see `tools/shared.ts#registerTool`). The end-to-end MCP test
    // exercises that path; here we assert the underlying contract.
    await expect(
      getOddsTool.handler({ match_id: "bogus" }, client),
    ).rejects.toMatchObject({
      name: "BotApiError",
      status: 404,
    });
  });
});
