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

export const DEFAULT_ANCHOR_MODE: AnchorMode = "off";

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
