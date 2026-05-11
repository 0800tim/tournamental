/**
 * Browser-side persistence for the user's bracket share guid.
 *
 * The share guid is the opaque token the public `/s/<guid>` route
 * resolves to a bracket. We keep it in its own localStorage key —
 * separate from the bracket draft — for three reasons:
 *
 *  1. The `Bracket` shape from `@vtorn/bracket-engine` is the strict
 *     contract used by the scoring + cascade engines, and we don't
 *     want to widen it just to hold a UI-layer identifier.
 *
 *  2. The guid is stable across saves of the same (tournament, user)
 *     pair. Storing it independently makes that invariant explicit:
 *     re-saving the bracket reads the stored guid and sends it back
 *     up so the server returns the same guid (and therefore the same
 *     share URL).
 *
 *  3. Offline-first: the user can mint a UUID v4 client-side before
 *     they ever hit the network. Once they save, we replace it with
 *     the server-canonical guid (in case the server amended it).
 *
 * No PII is stored. Key shape: `vtorn:share_guid:<tournament>:<user>`.
 */

const STORAGE_PREFIX = "vtorn:share_guid";

export function shareGuidKey(
  tournament_id: string,
  user_local_id: string,
): string {
  return `${STORAGE_PREFIX}:${tournament_id}:${user_local_id}`;
}

export function loadStoredShareGuid(
  tournament_id: string,
  user_local_id: string,
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(
      shareGuidKey(tournament_id, user_local_id),
    );
    return v && v.trim() ? v : null;
  } catch {
    // localStorage can throw in private-browsing on some browsers.
    return null;
  }
}

export function saveStoredShareGuid(
  tournament_id: string,
  user_local_id: string,
  share_guid: string,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      shareGuidKey(tournament_id, user_local_id),
      share_guid,
    );
  } catch {
    // Same as load — silent swallow keeps the save UX intact.
  }
}

export function clearStoredShareGuid(
  tournament_id: string,
  user_local_id: string,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(shareGuidKey(tournament_id, user_local_id));
  } catch {
    // Same as save.
  }
}
