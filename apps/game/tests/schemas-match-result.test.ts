/**
 * matchResultBodySchema accepts every stage the fixtures and the
 * results poller send, including the third-place play-off ("tp"),
 * which the enum lacked until 2026-10-20 so the bronze final could not
 * be settled through POST /v1/match/:id/result.
 */
import { describe, expect, it } from "vitest";

import { matchResultBodySchema } from "../src/schemas.js";

const base = { tournament_id: "fifa-wc-2026", outcome: "home_win" as const, homeScore: 2, awayScore: 1, winner: "ENG" };

describe("matchResultBodySchema stage", () => {
  it.each(["group", "r32", "r16", "qf", "sf", "tp", "f"])("accepts stage %s", (stage) => {
    const r = matchResultBodySchema.safeParse({ ...base, stage });
    expect(r.success, stage).toBe(true);
  });

  it("still rejects an unknown stage", () => {
    expect(matchResultBodySchema.safeParse({ ...base, stage: "final" }).success).toBe(false);
    expect(matchResultBodySchema.safeParse({ ...base, stage: "bronze" }).success).toBe(false);
  });

  it("keeps stage optional", () => {
    expect(matchResultBodySchema.safeParse(base).success).toBe(true);
  });
});

describe("matchResultBodySchema method", () => {
  it.each(["ft", "et", "pens", "kicks"])("accepts method %s", (method) => {
    expect(matchResultBodySchema.safeParse({ ...base, method }).success).toBe(true);
  });
  it("rejects an unknown method and keeps it optional", () => {
    expect(matchResultBodySchema.safeParse({ ...base, method: "aet" }).success).toBe(false);
    expect(matchResultBodySchema.safeParse(base).success).toBe(true);
  });
});
