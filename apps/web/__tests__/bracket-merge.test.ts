/**
 * Tests for the local/server bracket merge.
 *
 * Coverage:
 *   - Newer-lockedAt wins for the same matchId.
 *   - One-sided picks are preserved (local-only + server-only kept).
 *   - The server bracketId takes precedence so subsequent per-match
 *     writes land on the same row.
 *   - groupTiebreakers merge by `setAt` (newer wins).
 */

import { describe, expect, it } from "vitest";

import type { Bracket } from "@vtorn/bracket-engine";

import { mergeBrackets } from "../lib/bracket/merge";

function empty(bracketId: string): Bracket {
  return {
    bracketId,
    matchPredictions: {},
    groupTiebreakers: {},
    knockoutPredictions: {},
    version: 1,
  };
}

describe("mergeBrackets", () => {
  it("newer lockedAt wins per match", () => {
    const local: Bracket = {
      ...empty("bk_local"),
      matchPredictions: {
        "1": {
          matchId: "1",
          outcome: "home_win",
          lockedAt: "2026-06-01T10:00:00.000Z",
        },
      },
    };
    const remote: Bracket = {
      ...empty("bk_server"),
      matchPredictions: {
        "1": {
          matchId: "1",
          outcome: "away_win",
          lockedAt: "2026-06-01T08:00:00.000Z",
        },
      },
    };
    const merged = mergeBrackets(local, remote);
    expect(merged.matchPredictions["1"]?.outcome).toBe("home_win");
    expect(merged.bracketId).toBe("bk_server");
  });

  it("server pick wins when it's newer than the local one", () => {
    const local: Bracket = {
      ...empty("bk_local"),
      matchPredictions: {
        "1": {
          matchId: "1",
          outcome: "home_win",
          lockedAt: "2026-06-01T08:00:00.000Z",
        },
      },
    };
    const remote: Bracket = {
      ...empty("bk_server"),
      matchPredictions: {
        "1": {
          matchId: "1",
          outcome: "away_win",
          lockedAt: "2026-06-01T10:00:00.000Z",
        },
      },
    };
    const merged = mergeBrackets(local, remote);
    expect(merged.matchPredictions["1"]?.outcome).toBe("away_win");
  });

  it("preserves picks present on only one side", () => {
    const local: Bracket = {
      ...empty("bk_local"),
      matchPredictions: {
        "1": {
          matchId: "1",
          outcome: "home_win",
          lockedAt: "2026-06-01T10:00:00.000Z",
        },
      },
      knockoutPredictions: {
        r32_01: {
          matchId: "r32_01",
          outcome: "home_win",
          lockedAt: "2026-06-02T10:00:00.000Z",
        },
      },
    };
    const remote: Bracket = {
      ...empty("bk_server"),
      matchPredictions: {
        "2": {
          matchId: "2",
          outcome: "draw",
          lockedAt: "2026-06-01T10:00:00.000Z",
        },
      },
    };
    const merged = mergeBrackets(local, remote);
    expect(Object.keys(merged.matchPredictions).sort()).toEqual(["1", "2"]);
    expect(merged.knockoutPredictions["r32_01"]?.outcome).toBe("home_win");
  });

  it("merges groupTiebreakers by setAt", () => {
    const local: Bracket = {
      ...empty("bk_local"),
      groupTiebreakers: {
        A: {
          groupId: "A" as const,
          rankedTeams: ["ARG", "MEX", "POL", "KSA"] as unknown as readonly [
            string,
            string,
            string,
            string,
          ],
          setAt: "2026-06-01T08:00:00.000Z",
        } as unknown as Bracket["groupTiebreakers"][string],
      },
    };
    const remote: Bracket = {
      ...empty("bk_server"),
      groupTiebreakers: {
        A: {
          groupId: "A" as const,
          rankedTeams: ["MEX", "ARG", "POL", "KSA"] as unknown as readonly [
            string,
            string,
            string,
            string,
          ],
          setAt: "2026-06-01T10:00:00.000Z",
        } as unknown as Bracket["groupTiebreakers"][string],
      },
    };
    const merged = mergeBrackets(local, remote);
    expect(merged.groupTiebreakers["A"]?.rankedTeams[0]).toBe("MEX");
  });
});
