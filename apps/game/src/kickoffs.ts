/**
 * Kickoff index for server-side lockout enforcement.
 *
 * Loads the canonical 2026 FIFA World Cup fixture data from
 * `@vtorn/bracket-engine` and indexes every match's kickoff time by the
 * match-id used in user-submitted brackets.
 *
 *   - Group fixtures: keyed by `String(match_no)` (1..72) — matches
 *     `groupMatchId()` in the web client.
 *   - Knockout fixtures: keyed by the engine's stable `id` (e.g. "r32_01",
 *     "final") — matches `knockoutMatchId()` in the web client.
 *
 * The lookup is tournament-scoped. If a tournament isn't recognised, the
 * service returns an "unknown kickoff" — the bracket-submit handler treats
 * that as "no kickoff to compare against" and accepts the prediction.
 *
 * Spec rule from CLAUDE.md: every prediction's `lockedAt` must be
 * strictly less than its match's `kickoff_utc`. Anything later is
 * rejected as `match_already_started`.
 */

import { loadFixtures2026 } from "@vtorn/bracket-engine";
import type { Tournament } from "@vtorn/bracket-engine";

export interface KickoffLookup {
  /** Tournament identifier these kickoffs belong to (e.g. "fifa-wc-2026"). */
  readonly tournamentId: string;
  /**
   * Returns the ISO-8601 kickoff time for `matchId`, or `null` if the match
   * isn't part of this tournament or its kickoff is unknown (e.g. a
   * knockout slot whose cascade hasn't been resolved yet).
   */
  kickoffFor(matchId: string): string | null;
  /**
   * Returns the canonical stage for `matchId` ("group", "r32", "r16", "qf",
   * "sf", "tp", "f"), or `null` if the match isn't part of this tournament.
   * Used by the per-match-pick endpoints to validate that `draw` is only
   * accepted on group-stage matches.
   */
  stageFor(matchId: string): string | null;
}

const NULL_LOOKUP: KickoffLookup = {
  tournamentId: "",
  kickoffFor: () => null,
  stageFor: () => null,
};

/**
 * Build a kickoff lookup from a Tournament structure. Group fixtures are
 * keyed by stringified `match_no`; knockout fixtures are keyed by `id`.
 */
export function buildKickoffLookup(tournament: Tournament): KickoffLookup {
  const kickoffMap = new Map<string, string>();
  const stageMap = new Map<string, string>();
  for (const f of tournament.group_fixtures) {
    kickoffMap.set(String(f.match_no), f.kickoff_utc);
    stageMap.set(String(f.match_no), "group");
  }
  for (const k of tournament.knockouts) {
    if (k.kickoff_utc) {
      kickoffMap.set(k.id, k.kickoff_utc);
    }
    stageMap.set(k.id, k.stage);
  }
  return {
    tournamentId: tournament.id,
    kickoffFor(matchId: string): string | null {
      return kickoffMap.get(matchId) ?? null;
    },
    stageFor(matchId: string): string | null {
      return stageMap.get(matchId) ?? null;
    },
  };
}

/**
 * Default registry: maps tournament id → kickoff lookup. Right now we
 * only ship the WC 2026 fixtures; future tournaments register here.
 */
export interface KickoffRegistry {
  /** Returns the kickoff lookup for `tournamentId`, or a null-lookup if unknown. */
  forTournament(tournamentId: string): KickoffLookup;
}

export function buildDefaultKickoffRegistry(): KickoffRegistry {
  let wc2026: KickoffLookup | null = null;
  return {
    forTournament(tournamentId: string): KickoffLookup {
      if (tournamentId === "fifa-wc-2026") {
        if (!wc2026) {
          wc2026 = buildKickoffLookup(loadFixtures2026());
        }
        return wc2026;
      }
      return NULL_LOOKUP;
    },
  };
}

export interface PredictionLockCheck {
  /** Whether the prediction is still ahead of kickoff. */
  readonly lockable: boolean;
  /** Kickoff used for the comparison, if known. */
  readonly kickoff_utc: string | null;
  /** Server-side `now()` used for the comparison, in ISO-8601 UTC. */
  readonly now: string;
}

/**
 * Decide whether a prediction is still lockable given a kickoff and a
 * candidate `lockedAt` (or current server time, for the
 * check-lockable endpoint). The prediction is lockable iff
 * `lockedAt < kickoff_utc`. If kickoff is unknown, treat as lockable.
 */
export function checkLockable(args: {
  kickoff_utc: string | null;
  lockedAtMs: number;
}): { lockable: boolean; kickoff_utc: string | null } {
  if (!args.kickoff_utc) {
    return { lockable: true, kickoff_utc: null };
  }
  const kickoffMs = Date.parse(args.kickoff_utc);
  if (Number.isNaN(kickoffMs)) {
    // Defensive: a malformed kickoff in fixtures shouldn't lock everyone
    // out. Fall back to "no kickoff to compare against".
    return { lockable: true, kickoff_utc: args.kickoff_utc };
  }
  return {
    lockable: args.lockedAtMs < kickoffMs,
    kickoff_utc: args.kickoff_utc,
  };
}
