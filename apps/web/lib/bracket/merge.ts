/**
 * Bracket merge, combine a local draft with a server-hydrated
 * bracket so we never clobber the user's newer offline picks.
 *
 * Two-rule per match:
 *
 *   1. If the match's kickoff is in the past (server clock, known via
 *      the `tournament` opt), the SERVER side wins outright. Any
 *      local-only change made after kickoff is a UI ghost that the
 *      server already rejected, so we must not surface it.
 *   2. Otherwise, newer `lockedAt` wins. If only one side has the
 *      pick, that side wins.
 *
 * Tim 2026-06-12: rule (1) was added after a real incident where a
 * user (0800tim) saw their bracket page show a draw pick while the
 * leaderboard correctly showed them with the home_win pick. Root
 * cause: they toggled local state from KOR → draw 11 seconds before
 * kickoff, then toggled again seconds after kickoff. The server
 * (rightly) only accepted the pre-kickoff edits, but `mergeBrackets`
 * was preferring the local post-kickoff edit on display because its
 * `lockedAt` was newer. The leaderboard scored honestly off the
 * server; the bracket page lied. Rule (1) makes the merge match the
 * server's view for any match that's already kicked off.
 *
 * Callers MUST pass `tournament` to get rule (1). Tests + the
 * sign-out → guest merge path call without it, in which case the
 * legacy newer-wins rule applies to everything (safe because the
 * tests are deterministic and the guest-migration path is a one-shot
 * that runs before any match is locked).
 *
 * `groupTiebreakers` follows the same newer-wins rule, keyed by
 * groupId and compared on `setAt`.
 */

import type {
  Bracket,
  GroupTiebreaker,
  MatchPrediction,
  Tournament,
} from "@tournamental/bracket-engine";

export interface MergeOpts {
  /**
   * Tournament fixtures (with kickoff_utc per match). When supplied,
   * any match whose kickoff is at-or-before `now` is "locked" and
   * the server side wins outright. When omitted, the legacy
   * newer-lockedAt-wins rule applies to every match.
   */
  readonly tournament?: Tournament;
  /** Defaults to `Date.now()`. Injectable for tests. */
  readonly now?: number;
}

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

/**
 * Build a flat lookup of matchId → kickoff_utc ms from a Tournament.
 * Group matches are keyed by `String(match_no)` to match the client's
 * `groupMatchId()` and server's kickoff index. Knockouts are keyed by
 * their stable `id` (e.g. "r32_01", "final"). Returns null for any
 * key the lookup doesn't know about, including knockout slots whose
 * cascade hasn't resolved.
 */
function buildKickoffMs(tournament: Tournament): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of tournament.group_fixtures) {
    const ms = parseTime(f.kickoff_utc);
    if (ms > 0) out.set(String(f.match_no), ms);
  }
  for (const k of tournament.knockouts) {
    if (k.kickoff_utc) {
      const ms = parseTime(k.kickoff_utc);
      if (ms > 0) out.set(k.id, ms);
    }
  }
  return out;
}

function mergePredictionMap(
  local: Record<string, MatchPrediction>,
  remote: Record<string, MatchPrediction>,
  kickoffMs: Map<string, number> | null,
  nowMs: number,
): Record<string, MatchPrediction> {
  const keys = new Set<string>([...Object.keys(local), ...Object.keys(remote)]);
  const out: Record<string, MatchPrediction> = {};
  for (const k of keys) {
    // Rule (1): server wins for past-kickoff matches. If the kickoff
    // is unknown (e.g. a knockout slot still to cascade), fall through
    // to the newer-lockedAt rule.
    const ko = kickoffMs?.get(k);
    if (ko !== undefined && nowMs >= ko) {
      const winner = remote[k] ?? local[k];
      if (winner) out[k] = winner;
      continue;
    }
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
 * Merge two brackets, preferring newer picks per match — except
 * for matches whose kickoff has passed, where the server wins
 * outright (rule (1) at the top of this file). The result keeps the
 * server's bracketId (so subsequent writes share the row); if the
 * server side is empty, falls back to the local one.
 */
export function mergeBrackets(
  local: Bracket,
  remote: Bracket,
  opts: MergeOpts = {},
): Bracket {
  const kickoffMs = opts.tournament ? buildKickoffMs(opts.tournament) : null;
  const nowMs = opts.now ?? Date.now();
  return {
    bracketId: remote.bracketId || local.bracketId,
    matchPredictions: mergePredictionMap(
      local.matchPredictions ?? {},
      remote.matchPredictions ?? {},
      kickoffMs,
      nowMs,
    ),
    groupTiebreakers: mergeTiebreakers(
      local.groupTiebreakers ?? {},
      remote.groupTiebreakers ?? {},
    ),
    // bestThirds is a set of 8 user-selected team ids with no
    // per-item timestamps. Whichever side has more picks wins; on a
    // tie (typical: both 0 or both 8), local takes precedence since
    // the user's most recent action is the local edit. Clearing
    // (8 → 0) needs an explicit server round-trip to land on the
    // server side too, otherwise the longer remote would persist.
    bestThirds:
      (local.bestThirds ?? []).length >= (remote.bestThirds ?? []).length
        ? (local.bestThirds ?? [])
        : (remote.bestThirds ?? []),
    knockoutPredictions: mergePredictionMap(
      local.knockoutPredictions ?? {},
      remote.knockoutPredictions ?? {},
      kickoffMs,
      nowMs,
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
