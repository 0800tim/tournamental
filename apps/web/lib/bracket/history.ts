/**
 * Prediction-history ledger.
 *
 * Records EVERY prediction change the user makes — initial picks,
 * edits, auto-pick fills, tiebreaker changes — into an append-only
 * localStorage array. This gives us:
 *
 *   1. **Replay analytics**: post-match we can answer "what did the
 *      user think before/after the group draw was published" or "did
 *      the user change their final pick after the favourites lost a
 *      group match".
 *   2. **Lock-time odds provenance**: every entry records the live odds
 *      at the moment of the change, so the scoring engine can settle
 *      points using the user's locked-in odds (early picks earn higher
 *      multipliers when they pan out).
 *   3. **Sync source-of-truth**: the game-service can pull the full
 *      ledger on submit, not just the latest snapshot, so we never lose
 *      provenance.
 *
 * Storage key: `vtorn:bracket:history:v1:<tournamentId>:<userId>`.
 *
 * The ledger is intentionally append-only — we never delete or compact
 * entries client-side. Server-side cleanup can compact after settlement
 * by retaining only the last entry per match.
 */
import type { MatchPrediction } from "@vtorn/bracket-engine";

import type { MatchOdds } from "@/lib/odds/types";

const VERSION = 1;

export type HistoryEventType =
  | "match_pick"          // group-stage outcome pick
  | "match_score"         // exact-score input changed
  | "tiebreaker_set"      // group tiebreaker ranking updated
  | "knockout_pick"       // knockout-round winner pick
  | "auto_pick_run";      // ⚡ Auto-pick action invocation marker

/**
 * One ledger entry. Compact on purpose so localStorage stays well
 * under the 5MB browser quota even after thousands of edits.
 */
export interface HistoryEntry {
  readonly type: HistoryEventType;
  /** Match id for match_pick / knockout_pick; group id for
   * tiebreaker_set; empty string for auto_pick_run. */
  readonly id: string;
  /** Outcome at this moment (after the change). */
  readonly outcome?: MatchPrediction["outcome"];
  /** Outcome before the change (undefined for first pick). */
  readonly prevOutcome?: MatchPrediction["outcome"];
  /** Live odds at time of change, when known. */
  readonly odds?: MatchPrediction["oddsAtLock"];
  /** ISO timestamp the change happened, client-side. */
  readonly ts: string;
  /** For auto_pick_run: number of picks the run produced. */
  readonly picksAdded?: number;
}

function key(tournamentId: string, userId: string): string {
  return `vtorn:bracket:history:v${VERSION}:${tournamentId}:${userId}`;
}

/** Load the ledger; tolerant of missing/corrupt data. */
export function loadHistory(tournamentId: string, userId: string): readonly HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key(tournamentId, userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as HistoryEntry[];
  } catch {
    return [];
  }
}

/** Append a single entry to the ledger. Cheap; one read+write. */
export function appendHistory(
  tournamentId: string,
  userId: string,
  entry: HistoryEntry,
): void {
  if (typeof window === "undefined") return;
  try {
    const existing = loadHistory(tournamentId, userId);
    const next = existing.concat(entry);
    window.localStorage.setItem(key(tournamentId, userId), JSON.stringify(next));
  } catch {
    /* localStorage full / private mode — drop silently; the prediction
     * itself is saved on the bracket draft path which is the
     * source-of-truth for what the user picks. */
  }
}

/** Build an `oddsAtLock` snapshot from a MatchOdds row. */
export function snapshotOdds(o: MatchOdds | null | undefined): MatchPrediction["oddsAtLock"] {
  if (!o) return undefined;
  return {
    homeWin: o.homeWin,
    draw: o.draw,
    awayWin: o.awayWin,
    source: o.source,
    capturedAt: new Date().toISOString(),
  };
}
