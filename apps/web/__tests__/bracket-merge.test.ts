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

import type { Bracket } from "@tournamental/bracket-engine";

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

  // Tim 2026-06-12: regression. The bracket UI was showing a local
  // post-kickoff toggle as the user's pick because mergeBrackets used
  // newer-lockedAt-wins indiscriminately. The leaderboard scored from
  // the server (correct) so user state was inconsistent across the
  // two surfaces. Once a match has kicked off, the server side is the
  // only truth — local edits made after kickoff are UI ghosts.
  it("server wins for past-kickoff matches even if local lockedAt is newer", () => {
    const tournament = {
      id: "fifa-wc-2026",
      group_fixtures: [
        {
          match_no: 2,
          group_id: "A" as const,
          home_idx: 2,
          away_idx: 3,
          kickoff_utc: "2026-06-12T02:00:00Z",
        },
      ],
      knockouts: [],
    } as unknown as Parameters<typeof mergeBrackets>[2] extends {
      tournament?: infer T;
    }
      ? T
      : never;

    const local: Bracket = {
      ...empty("bk_local"),
      matchPredictions: {
        "2": {
          matchId: "2",
          // User toggled to draw 30 seconds AFTER kickoff. Server
          // would have rejected this; the client shouldn't render it.
          outcome: "draw",
          lockedAt: "2026-06-12T02:00:30.000Z",
        },
      },
    };
    const remote: Bracket = {
      ...empty("bk_server"),
      matchPredictions: {
        "2": {
          matchId: "2",
          // Final pre-kickoff pick the server accepted, 30 sec before
          // kickoff.
          outcome: "home_win",
          lockedAt: "2026-06-12T01:59:30.000Z",
        },
      },
    };

    const merged = mergeBrackets(local, remote, {
      tournament,
      now: Date.parse("2026-06-12T04:00:00.000Z"), // 2h after kickoff
    });
    expect(merged.matchPredictions["2"]?.outcome).toBe("home_win");
  });

  // Mirror of the rule above for future matches: a local edit made
  // before kickoff should still win against an older server pick.
  it("local pick still wins for future matches when its lockedAt is newer", () => {
    const tournament = {
      id: "fifa-wc-2026",
      group_fixtures: [
        {
          match_no: 7,
          group_id: "B" as const,
          home_idx: 0,
          away_idx: 1,
          kickoff_utc: "2026-06-12T19:00:00Z",
        },
      ],
      knockouts: [],
    } as unknown as Parameters<typeof mergeBrackets>[2] extends {
      tournament?: infer T;
    }
      ? T
      : never;

    const local: Bracket = {
      ...empty("bk_local"),
      matchPredictions: {
        "7": {
          matchId: "7",
          outcome: "draw",
          lockedAt: "2026-06-12T10:00:00.000Z",
        },
      },
    };
    const remote: Bracket = {
      ...empty("bk_server"),
      matchPredictions: {
        "7": {
          matchId: "7",
          outcome: "home_win",
          lockedAt: "2026-06-12T08:00:00.000Z",
        },
      },
    };
    const merged = mergeBrackets(local, remote, {
      tournament,
      now: Date.parse("2026-06-12T12:00:00.000Z"), // before 19:00 kickoff
    });
    expect(merged.matchPredictions["7"]?.outcome).toBe("draw");
  });
});
