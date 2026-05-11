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
import {
  loadStoredShareGuid,
  saveStoredShareGuid,
} from "../share/share-guid-storage.js";

export interface SubmitResult {
  readonly ok: boolean;
  readonly status: "submitted" | "saved_offline" | "api_error";
  readonly bracket_id?: string;
  readonly error?: string;
  /** Server-confirmed lock timestamp (only set when `status === "submitted"`). */
  readonly locked_at?: string;
  /**
   * Server-returned share guid — what the user copies into the share
   * URL (`https://play.tournamental.com/s/<guid>`). Only set when
   * `status === "submitted"`. The save handler guarantees the same
   * guid persists across re-saves of the same bracket.
   */
  readonly share_guid?: string;
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

/** Mint a UUID v4 the server accepts as a share guid. */
function mintClientShareGuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Last-resort fallback for ancient browsers (no crypto.randomUUID).
  // RFC-4122 v4 layout — close enough for the guid shape regex.
  const r = Math.random;
  const hex = (n: number) =>
    Math.floor(r() * 16 ** n)
      .toString(16)
      .padStart(n, "0");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(r() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
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

  // Re-use the share guid from a prior save (so re-saves keep the
  // SAME share URL stable across edits); mint a new one if this is
  // the first save on this device.
  const existingGuid = loadStoredShareGuid(tournament_id, user_local_id);
  const clientShareGuid = existingGuid ?? mintClientShareGuid();

  const result = await saveFullBracket({
    userId: user_local_id,
    tournamentId: tournament_id,
    bracket,
    shareGuid: clientShareGuid,
  });

  if (result.ok) {
    // Mirror the server's bracketId back into localStorage so a
    // subsequent per-match PUT can reference the same row.
    saveDraft(
      tournament_id,
      { ...bracket, bracketId: result.bracketId },
      user_local_id,
    );
    // Persist the canonical (server-returned) share guid. On the next
    // save we send THIS guid up so the server doesn't have to mint a
    // new one and the share URL is stable.
    if (result.shareGuid) {
      saveStoredShareGuid(tournament_id, user_local_id, result.shareGuid);
    }
    return {
      ok: true,
      status: "submitted",
      bracket_id: result.bracketId,
      locked_at: result.lockedAt,
      ...(result.shareGuid ? { share_guid: result.shareGuid } : {}),
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
