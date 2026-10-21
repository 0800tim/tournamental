/**
 * Rugby try counts on picks and results. Both schemas are strict, so
 * without these fields a rugby bracket could not carry the inputs the
 * engine's bonus points and tries tiebreaks need.
 */
import { describe, expect, it } from "vitest";

import { matchPredictionSchema, matchResultBodySchema } from "../src/schemas.js";

const pick = { matchId: "1", outcome: "home_win" as const, homeScore: 38, awayScore: 31, lockedAt: "2027-09-01T00:00:00Z" };
const result = { tournament_id: "rwc-2027", outcome: "home_win" as const, homeScore: 38, awayScore: 31, winner: "NZL" };

describe("try counts", () => {
  it("accepts homeTries and awayTries on a pick and on a result", () => {
    expect(matchPredictionSchema.safeParse({ ...pick, homeTries: 5, awayTries: 4 }).success).toBe(true);
    expect(matchResultBodySchema.safeParse({ ...result, homeTries: 5, awayTries: 4 }).success).toBe(true);
  });

  it("keeps them optional", () => {
    expect(matchPredictionSchema.safeParse(pick).success).toBe(true);
    expect(matchResultBodySchema.safeParse(result).success).toBe(true);
  });

  it("rejects negative, fractional and absurd counts", () => {
    expect(matchPredictionSchema.safeParse({ ...pick, homeTries: -1, awayTries: 0 }).success).toBe(false);
    expect(matchPredictionSchema.safeParse({ ...pick, homeTries: 1.5, awayTries: 0 }).success).toBe(false);
    expect(matchResultBodySchema.safeParse({ ...result, homeTries: 31, awayTries: 0 }).success).toBe(false);
  });
});
