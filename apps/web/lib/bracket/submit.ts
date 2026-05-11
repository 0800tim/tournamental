/**
 * Bracket submission handler.
 *
 * Hits `POST /v1/bracket/submit` on the game service
 * (game.tournamental.com per docs/22) and returns a status the UI
 * can render. localStorage is written *first* so the user never
 * loses their picks if the network hiccups; on server success we
 * also rewrite the local draft with the canonical version so the
 * bracketId stays in sync.
 *
 * Caching: this is a write path; per the standing rule in CLAUDE.md
 * the endpoint is `private, no-store` on the server side and we
 * pass `cache: "no-store"` on the fetch.
 */

import type { Bracket } from "@vtorn/bracket-engine";

import { saveFullBracket } from "./api.js";
import { saveDraft } from "./storage.js";

export interface SubmitResult {
  readonly ok: boolean;
  readonly status: "submitted" | "saved_offline" | "api_error";
  readonly bracket_id?: string;
  readonly error?: string;
  /** Server-confirmed lock timestamp (only set when `status === "submitted"`). */
  readonly locked_at?: string;
  /**
   * Predictions the server rejected because their match had already
   * kicked off. The caller can render a "couldn't save N picks" note.
   */
  readonly rejected?: ReadonlyArray<{
    readonly matchId: string;
    readonly error: string;
    readonly kickoff_utc: string;
    readonly lockedAt: string;
  }>;
}

export async function submitBracket(
  tournament_id: string,
  bracket: Bracket,
  user_local_id: string,
): Promise<SubmitResult> {
  // Always save the draft locally first so the user never loses their
  // picks if the request fails. The server-success branch rewrites
  // this with the canonical bracketId returned by the server.
  saveDraft(tournament_id, bracket, user_local_id);

  const result = await saveFullBracket({
    userId: user_local_id,
    tournamentId: tournament_id,
    bracket,
  });

  if (result.ok) {
    // Mirror the server's bracketId back into localStorage so a
    // subsequent per-match PUT can reference the same row.
    saveDraft(
      tournament_id,
      { ...bracket, bracketId: result.bracketId },
      user_local_id,
    );
    return {
      ok: true,
      status: "submitted",
      bracket_id: result.bracketId,
      locked_at: result.lockedAt,
      ...(result.rejected ? { rejected: result.rejected } : {}),
    };
  }

  // Network error or timeout → keep the local draft, surface a
  // soft-failure status the UI can render as "saved offline".
  if (
    result.code === "network_error" ||
    result.code === "timeout" ||
    result.code === "no_fetch" ||
    result.status >= 500
  ) {
    return {
      ok: false,
      status: "saved_offline",
      error: result.code,
    };
  }
  return {
    ok: false,
    status: "api_error",
    error: result.code,
  };
}
