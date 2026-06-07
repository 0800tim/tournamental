import { describe, expect, it } from "vitest";

import { getMatchesTool } from "../src/tools/get-matches.js";
import { decodeMcp, makeClient } from "./helpers.js";

describe("get_matches tool", () => {
  it("hits the matches endpoint and returns the catalogue", async () => {
    const matches = {
      tournament_id: "fifa-wc-2026",
      matches: [
        { id: "1", stage: "group", home_code: "MEX", away_code: "POL", kickoff_utc: "2026-06-11T18:00:00Z" },
        { id: "2", stage: "group", home_code: "USA", away_code: "WAL", kickoff_utc: "2026-06-12T18:00:00Z" },
      ],
    };
    const { client, calls } = makeClient([
      {
        method: "GET",
        path: "/v1/tournaments/fifa-wc-2026/matches",
        body: matches,
      },
    ]);

    const res = await getMatchesTool.handler({}, client);
    const decoded = decodeMcp(res);

    expect(decoded.isError).toBe(false);
    expect(decoded.payload).toEqual(matches);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
  });

  it("respects a non-default tournament_id", async () => {
    const matches = { tournament_id: "uefa-euro-2028", matches: [] };
    const { client, calls } = makeClient([
      { method: "GET", path: "/v1/tournaments/uefa-euro-2028/matches", body: matches },
    ]);

    const res = await getMatchesTool.handler({ tournament_id: "uefa-euro-2028" }, client);
    const decoded = decodeMcp(res);

    expect(decoded.isError).toBe(false);
    expect(decoded.payload).toEqual(matches);
    expect(calls[0]?.url).toContain("/v1/tournaments/uefa-euro-2028/matches");
  });
});
