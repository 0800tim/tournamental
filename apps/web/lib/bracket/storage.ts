/**
 * Browser-side persistence for the user's bracket draft.
 *
 * "Save draft" writes to localStorage so the user can pick up where they
 * left off without auth. "Submit final" POSTs to the API once the API
 * lands; until then, the submit handler logs + warns + still writes
 * draft.
 *
 * Cache policy: localStorage is per-origin and keyed by tournament id +
 * a stable user-local id. No PII is written.
 */

import type { BracketPrediction } from "@vtorn/bracket-engine";

const STORAGE_PREFIX = "vtorn:bracket:v1";

export function draftKey(tournament_id: string, user_local_id: string): string {
  return `${STORAGE_PREFIX}:${tournament_id}:${user_local_id}`;
}

export function loadDraft(
  tournament_id: string,
  user_local_id: string,
): BracketPrediction | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(draftKey(tournament_id, user_local_id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BracketPrediction;
  } catch {
    return null;
  }
}

export function saveDraft(prediction: BracketPrediction, user_local_id: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    draftKey(prediction.tournament_id, user_local_id),
    JSON.stringify(prediction),
  );
}

/**
 * Stable per-browser id. NOT a real user id — the API will swap this for
 * an authenticated user_id once we ship `apps/api` auth.
 */
export function localUserId(): string {
  if (typeof window === "undefined") return "ssr_user";
  const KEY = "vtorn:local_user_id";
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    // crypto.randomUUID is available in modern browsers + Node 19+
    id = (
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : "u_" + Math.random().toString(36).slice(2, 12)
    ) as string;
    window.localStorage.setItem(KEY, id);
  }
  return id;
}
