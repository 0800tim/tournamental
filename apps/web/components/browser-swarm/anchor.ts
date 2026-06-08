/**
 * User-anchored swarm slider.
 *
 * The default swarm anchors every bot to chalk-weighted odds: the bot
 * with the lowest deviation rank (index 0) just picks the favourite
 * every time. As the user climbs the slider to "Soft" / "Strong" /
 * "Lockstep" the chalk anchor blends with the user's own bracket
 * draft so the swarm trends toward the user's predictions.
 *
 * Anchor weights:
 *   - Off       (0.00) - pure chalk + uniqueness perturbation.
 *   - Soft      (0.40) - 40% the user's pick, 60% chalk.
 *   - Strong    (0.75) - 75% user, 25% chalk.
 *   - Lockstep  (1.00) - every bot starts from the user's bracket and
 *                        the uniqueness algorithm only varies the
 *                        outcome on whichever match the user hasn't
 *                        picked yet. Useful as the "10,000 copies of
 *                        my bracket" play.
 *
 * Storage:
 *   - The anchor weight itself lives in IndexedDB
 *     `swarm_state.anchor_weight` so it survives a tab close.
 *   - Each committed batch records the SHA256 hash of the user's
 *     bracket at generation time inside `commit_log.anchor_hash`. The
 *     NEXT batch the user generates picks up whatever weight + bracket
 *     is live AT THAT MOMENT, but already-committed batches stay
 *     locked at the snapshot they were generated against. This is the
 *     spec's "bracket hash recorded in commit_log" anchor-stability
 *     requirement (§16 forward-compat, per the A11 brief).
 *
 * The user's bracket lives in localStorage under the existing
 * `vtorn:bracket:v2:fifa-wc-2026:<user_local_id>` key (see
 * `apps/web/lib/bracket/storage.ts`). We re-read it on every call to
 * `loadAnchor()` so the slider sees the latest edits.
 */

import type { Bracket } from "@tournamental/bracket-engine";

import { loadServerBracket } from "@/lib/bracket/api";
import { localUserId } from "@/lib/bracket/storage";

import type { Outcome } from "./types";

export type AnchorMode = "off" | "soft" | "strong" | "lockstep";

export const ANCHOR_WEIGHT_BY_MODE: Record<AnchorMode, number> = {
  off: 0,
  soft: 0.4,
  strong: 0.75,
  lockstep: 1,
};

export const ANCHOR_LABEL_BY_MODE: Record<AnchorMode, string> = {
  off: "Off",
  soft: "Soft (40%)",
  strong: "Strong (75%)",
  lockstep: "Lockstep (100%)",
};

/**
 * Tim 2026-06-08: default the anchor to Strong. The swarm's whole
 * credibility hinges on the bots backing the user's bracket, so a fresh
 * tab now centres the swarm on the user's champion out of the box. The
 * saved choice in `swarm_state.anchor_weight` always wins over this
 * default once the user has touched the dropdown (the loader in
 * BrowserSwarm.tsx restores it), so this only governs the very first
 * render before any state has been persisted.
 */
export const DEFAULT_ANCHOR_MODE: AnchorMode = "strong";

/**
 * Snapshot of the user's bracket at anchor capture time. The hash is
 * what each committed batch stores in its commit log row so a future
 * audit can prove which user bracket the batch was anchored to.
 */
export interface AnchorSnapshot {
  /** Anchor weight in [0, 1]; same value as ANCHOR_WEIGHT_BY_MODE[mode]. */
  readonly weight: number;
  /** Per-match user pick. matchId -> Outcome. Empty if no draft. */
  readonly picks: Readonly<Record<string, Outcome>>;
  /** SHA256-ish hash (hex) of the canonical picks JSON. Cheap to compute
   *  using the merkle helper but we just FNV-mix here so the worker
   *  doesn't need WebCrypto on the hot path. The hash is opaque to the
   *  central server, used only as a stable identifier. */
  readonly bracket_hash: string;
  /** Timestamp of when this snapshot was captured. */
  readonly captured_at_utc: string;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(input: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/**
 * Deterministic hash of a picks-by-match map. Two snapshots with the
 * same picks always produce the same hash; any single-pick change
 * changes the hash. We FNV-mix two pass slots for a 64-bit-ish
 * fingerprint (8 hex chars + 8 hex chars).
 */
function hashPicks(picks: Readonly<Record<string, Outcome>>): string {
  const ids = Object.keys(picks).sort();
  if (ids.length === 0) return "00000000:00000000";
  let h1 = FNV_OFFSET;
  let h2 = FNV_OFFSET;
  for (const id of ids) {
    const outcome = picks[id]!;
    h1 = fnv1a(`${id}|${outcome}|${h1.toString(16)}`);
    h2 = fnv1a(`${outcome}|${id}|${h2.toString(16)}`);
  }
  return `${h1.toString(16).padStart(8, "0")}:${h2.toString(16).padStart(8, "0")}`;
}

const STORAGE_PREFIX = "vtorn:bracket:v2";

function bracketDraftKey(
  tournament_id: string,
  user_local_id: string,
): string {
  return `${STORAGE_PREFIX}:${tournament_id}:${user_local_id}`;
}

/** Local user id (mirrors `apps/web/lib/bracket/storage.ts#localUserId`). */
function readLocalUserId(): string {
  if (typeof window === "undefined") return "ssr_user";
  const KEY = "vtorn:local_user_id";
  return window.localStorage.getItem(KEY) ?? "ssr_user";
}

/**
 * Read the user's current bracket draft for a tournament. Returns null
 * if no draft has been saved (the user hasn't visited /world-cup-2026
 * yet, or wiped storage). Reads ONLY; never writes.
 */
export function readUserBracketDraft(
  tournament_id: string,
): Bracket | null {
  if (typeof window === "undefined") return null;
  const userId = readLocalUserId();
  const raw = window.localStorage.getItem(
    bracketDraftKey(tournament_id, userId),
  );
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Bracket;
  } catch {
    return null;
  }
}

/**
 * Project a user bracket onto a flat picks-by-match-id map. The
 * Bracket shape stores group + knockout predictions separately; the
 * swarm's anchor blender wants a single lookup table.
 */
export function flattenBracket(
  bracket: Bracket | null,
): Readonly<Record<string, Outcome>> {
  if (!bracket) return {};
  const out: Record<string, Outcome> = {};
  for (const [id, p] of Object.entries(bracket.matchPredictions ?? {})) {
    out[id] = p.outcome;
  }
  for (const [id, p] of Object.entries(bracket.knockoutPredictions ?? {})) {
    out[id] = p.outcome;
  }
  return out;
}

/**
 * Capture an anchor snapshot from the live store. Defaults to the
 * default mode + no picks when there's nothing in storage; callers can
 * still safely blend against it.
 */
export function captureAnchorSnapshot(
  tournament_id: string,
  mode: AnchorMode,
): AnchorSnapshot {
  const draft = readUserBracketDraft(tournament_id);
  const picks = flattenBracket(draft);
  return {
    weight: ANCHOR_WEIGHT_BY_MODE[mode],
    picks,
    bracket_hash: hashPicks(picks),
    captured_at_utc: new Date().toISOString(),
  };
}

/**
 * Build a snapshot from an already-resolved picks map. Used by the async
 * capture path once it has decided whether the local draft or the server
 * bracket is authoritative.
 */
function snapshotFromPicks(
  picks: Readonly<Record<string, Outcome>>,
  mode: AnchorMode,
): AnchorSnapshot {
  return {
    weight: ANCHOR_WEIGHT_BY_MODE[mode],
    picks,
    bracket_hash: hashPicks(picks),
    captured_at_utc: new Date().toISOString(),
  };
}

/**
 * Async anchor capture with a SERVER-bracket fallback.
 *
 * Root-cause fix for the "Last anchor hash: 00000000:00000000" bug: the
 * user's bracket is authoritative on the game-service (he made picks
 * that synced server-side), but his localStorage on the /run origin can
 * be empty (he built the bracket on a different origin / device). When
 * the local draft is empty we fall back to `GET /v1/bracket/me` and
 * flatten the server bracket instead, so the swarm anchors to his real
 * Portugal-as-champion bracket rather than to nothing.
 *
 * Resolution order:
 *   1. localStorage draft (instant, no network) - used if non-empty.
 *   2. server bracket via loadServerBracket (cookie session) - used when
 *      the local draft has zero picks.
 *   3. empty snapshot - only if both are empty (genuinely no bracket).
 *
 * The result MUST be captured once and cached by the caller (it is async
 * and we don't want to re-read the server on every render); pass the
 * cached snapshot down to the deterministic regenerate functions.
 *
 * Determinism is preserved: the snapshot is a frozen picks map + weight,
 * and `blendOutcome` consumes a caller-supplied seeded `r`, so the same
 * (snapshot, seed) always yields the same picks.
 */
export async function captureAnchorSnapshotAsync(
  tournament_id: string,
  mode: AnchorMode,
): Promise<AnchorSnapshot> {
  const localDraft = readUserBracketDraft(tournament_id);
  const localPicks = flattenBracket(localDraft);
  if (Object.keys(localPicks).length > 0) {
    return snapshotFromPicks(localPicks, mode);
  }

  // Local draft empty: try the server bracket. Cookie-forwarded; for a
  // logged-in user this returns their real champion + knockout path.
  if (typeof window !== "undefined") {
    try {
      const res = await loadServerBracket({
        userId: localUserId(),
        tournamentId: tournament_id,
      });
      if (res.ok) {
        const serverPicks = flattenBracket(res.bracket);
        if (Object.keys(serverPicks).length > 0) {
          return snapshotFromPicks(serverPicks, mode);
        }
      }
    } catch {
      // Network / auth failure: fall through to an empty snapshot. The
      // swarm still runs (pure chalk for those matches).
    }
  }

  return snapshotFromPicks({}, mode);
}

/**
 * Deterministic [0, 1) draw per (botIndex, matchId) for the anchor
 * blend. Mirrors the worker's `anchorDraw` so the on-demand regenerate
 * path (list + detail pages) and the worker's committed picks agree
 * bit-for-bit. Load-bearing: same (botIndex, matchId) always returns the
 * same r, so same (seed, bracket, weight) => identical picks.
 *
 * Used for GROUP matches: independent per match, so each bot's group
 * stage keeps a realistic spread of upsets even at high weight.
 */
export function anchorDrawFor(botIndex: number, matchId: string): number {
  const h = fnv1a(`anchor:${botIndex}:${matchId}`);
  return (h >>> 0) / 0x1_0000_0000;
}

/**
 * Path-level [0, 1) draw per bot, used for KNOCKOUT matches.
 *
 * Why correlate the knockout draws? The champion is a PATH outcome (the
 * bot must follow the user across every round to crown the user's
 * champion). If each knockout re-rolled independently at weight w, the
 * champion-follow rate would collapse to ~w^depth (e.g. 0.75^4 ≈ 0.32),
 * so "Strong" would barely move the champion column - which is exactly
 * the bug we are fixing. Instead, one path-level draw decides whether a
 * given bot follows the user's bracket through the ENTIRE knockout tree.
 * That makes the champion-follow rate ≈ the anchor weight directly (so
 * Strong ≈ 75% of bots crown the user's champion) with a clean
 * diversified tail of ≈ (1 - weight) bots running pure chalk knockouts.
 *
 * Determinism holds: keyed on botIndex alone, so it is stable across the
 * worker, the list page, and the detail page.
 */
export function anchorPathDrawFor(botIndex: number): number {
  const h = fnv1a(`anchor-path:${botIndex}`);
  return (h >>> 0) / 0x1_0000_0000;
}

/**
 * Pick the right anchor draw for a match: path-level for knockouts
 * (so a bot follows the user's whole bracket or none of it, making the
 * champion bias track the weight), per-match for group games (so the
 * group stage keeps a realistic spread). `allowsDraw` distinguishes the
 * two (group fixtures allow draws, knockouts do not).
 */
export function anchorDrawForMatch(
  botIndex: number,
  matchId: string,
  allowsDraw: boolean,
): number {
  return allowsDraw
    ? anchorDrawFor(botIndex, matchId)
    : anchorPathDrawFor(botIndex);
}

/**
 * Blend the chalk-picked outcome with the user's pick by anchor
 * weight. Per the spec:
 *
 *   effective_pick = anchor_weight * user_pick + (1 - anchor_weight) * chalk_pick
 *
 * Because outcomes are discrete we sample: a uniform [0, 1) draw under
 * `anchor_weight` returns the user's pick; otherwise the chalk pick.
 * For lockstep (weight = 1) the user pick wins whenever it's defined.
 *
 * `r` is a deterministic [0, 1) draw the caller supplies (e.g. from a
 * seeded PRNG per bot+match) so this function stays pure and
 * unit-testable.
 */
export function blendOutcome(
  matchId: string,
  chalkOutcome: Outcome,
  snapshot: AnchorSnapshot,
  r: number,
): Outcome {
  const userPick = snapshot.picks[matchId];
  if (userPick === undefined || snapshot.weight <= 0) return chalkOutcome;
  if (snapshot.weight >= 1) return userPick;
  return r < snapshot.weight ? userPick : chalkOutcome;
}

/**
 * Convenience: turn an anchor mode label into its numeric weight.
 */
export function weightForMode(mode: AnchorMode): number {
  return ANCHOR_WEIGHT_BY_MODE[mode];
}

/**
 * The 2026 tournament id all browser-swarm anchor logic uses by
 * default. Centralised so future tournaments only update one constant.
 */
export const ANCHOR_TOURNAMENT_ID = "fifa-wc-2026";
