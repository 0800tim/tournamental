/**
 * Bracket merge, combine a local draft with a server-hydrated
 * bracket so we never clobber the user's newer offline picks.
 *
 * Rule per match: whichever side has the most recent `lockedAt`
 * wins. If only one side has the pick, that side wins. The
 * combined bracket is otherwise the union (server bracketId
 * takes precedence so future per-match writes land on the same
 * row).
 *
 * `groupTiebreakers` follows the same newer-wins rule, keyed by
 * groupId and compared on `setAt`.
 */

import type {
  Bracket,
  GroupTiebreaker,
  MatchPrediction,
} from "@vtorn/bracket-engine";

function parseTime(s: string | undefined | null): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function pickNewer<T extends { lockedAt: string } | { setAt: string }>(
  a: T | undefined,
  b: T | undefined,
  field: "lockedAt" | "setAt",
): T | undefined {
  if (!a) return b;
  if (!b) return a;
  const ta = parseTime((a as unknown as Record<string, string | undefined>)[field]);
  const tb = parseTime((b as unknown as Record<string, string | undefined>)[field]);
  return tb > ta ? b : a;
}

function mergePredictionMap(
  local: Record<string, MatchPrediction>,
  remote: Record<string, MatchPrediction>,
): Record<string, MatchPrediction> {
  const keys = new Set<string>([...Object.keys(local), ...Object.keys(remote)]);
  const out: Record<string, MatchPrediction> = {};
  for (const k of keys) {
    const winner = pickNewer(local[k], remote[k], "lockedAt");
    if (winner) out[k] = winner;
  }
  return out;
}

function mergeTiebreakers(
  local: Record<string, GroupTiebreaker>,
  remote: Record<string, GroupTiebreaker>,
): Record<string, GroupTiebreaker> {
  const keys = new Set<string>([...Object.keys(local), ...Object.keys(remote)]);
  const out: Record<string, GroupTiebreaker> = {};
  for (const k of keys) {
    const winner = pickNewer(local[k], remote[k], "setAt");
    if (winner) out[k] = winner;
  }
  return out;
}

/**
 * Merge two brackets, preferring newer picks per match. The result
 * keeps the server's bracketId (so subsequent writes share the row);
 * if the server side is empty, falls back to the local one.
 */
export function mergeBrackets(local: Bracket, remote: Bracket): Bracket {
  return {
    bracketId: remote.bracketId || local.bracketId,
    matchPredictions: mergePredictionMap(
      local.matchPredictions ?? {},
      remote.matchPredictions ?? {},
    ),
    groupTiebreakers: mergeTiebreakers(
      local.groupTiebreakers ?? {},
      remote.groupTiebreakers ?? {},
    ),
    knockoutPredictions: mergePredictionMap(
      local.knockoutPredictions ?? {},
      remote.knockoutPredictions ?? {},
    ),
    // lockedAt only present once the user has bulk-submitted; prefer
    // the latest of the two.
    ...(remote.lockedAt || local.lockedAt
      ? {
          lockedAt:
            parseTime(remote.lockedAt) > parseTime(local.lockedAt)
              ? remote.lockedAt
              : local.lockedAt,
        }
      : {}),
    version: Math.max(local.version ?? 1, remote.version ?? 1),
  };
}
