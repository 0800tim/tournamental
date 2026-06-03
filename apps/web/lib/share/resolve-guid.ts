/**
 * Resolver for the `/s/<guid>` universal share path.
 *
 * Resolution order:
 *   1. Syndicate slug (e.g. `/s/argentina-pool`) → "syndicate"
 *   2. Share guid shape (UUID v4 / 16-char nanoid / `u_<hex>+`) → "user"
 *      (this is the immutable permalink form — what `Save & share` shows
 *      in the copy-link field, and what every previously-sent share URL
 *      still uses; never breaks)
 *   3. Friendly handle (slugified display_name) → "user" via auth-sms
 *      lookup → game-service latest-bracket-by-user-id (Tim 2026-05-24,
 *      the `/s/0800tim` shape)
 *   4. → "not_found"
 *
 * Reserved slugs (`/s/play`, `/s/api`, `/s/world-cup`) never resolve
 * via syndicate or handle branches; they fall through to 404.
 *
 * Pure-logic over the store + lookup helpers so the unit test in
 * `__tests__/s-guid-resolver.test.ts` can stub each branch independently.
 */

import {
  loadBracketFromGuid,
  loadBracketByHandle,
  isShareGuidShape,
  lookupUserByHandle,
  type BracketByGuid,
} from "@/lib/bracket/by-guid";
import { loadSyndicateBySlug, type SyndicateRecord } from "@/lib/syndicate/store";
import {
  isReservedSlug,
  isValidSlugShape,
} from "@/lib/syndicate/reserved-slugs";
import { isHandleShape } from "@/lib/share/handle-slug";

export type ResolvedShare =
  | { readonly kind: "syndicate"; readonly syndicate: SyndicateRecord }
  | { readonly kind: "user"; readonly bracket: BracketByGuid }
  | {
      /**
       * Handle resolved to a real auth-sms user, but that user has
       * not yet saved a bracket on the game-service. We render a
       * friendly "they haven't shared a bracket yet" view instead of
       * the generic 404 so the visitor knows whose link they followed.
       */
      readonly kind: "user_no_bracket";
      readonly handle: string;
      readonly userId: string;
      readonly displayName: string | null;
    }
  | { readonly kind: "not_found"; readonly attempted: string };

export interface ResolveOptions {
  /**
   * When true, the user-bracket branch fetches the full persisted
   * `Bracket` payload alongside the public summary. Used by the
   * share-landing page so the read-only 3D molecule embed can render
   * the saved picks without a second round-trip.
   */
  readonly includePayload?: boolean;
}

export async function resolveShareGuid(
  raw: string,
  opts: ResolveOptions = {},
): Promise<ResolvedShare> {
  const guid = (raw ?? "").trim();
  if (!guid) return { kind: "not_found", attempted: raw };

  // Step 1, syndicate slug. Only attempt if the shape is a valid slug
  // and the name is NOT reserved. A reserved slug never resolves here.
  if (isValidSlugShape(guid) && !isReservedSlug(guid)) {
    const syndicate = await loadSyndicateBySlug(guid);
    if (syndicate) return { kind: "syndicate", syndicate };
  }

  // Step 2, share-guid shape (UUID v4, 16-char nanoid, or auth-sms
  // `u_<hex>`). Permalink path; the saved-bracket form everyone has
  // already shared resolves here.
  if (isShareGuidShape(guid)) {
    const bracket = await loadBracketFromGuid(guid, {
      includePayload: opts.includePayload,
    });
    if (bracket) return { kind: "user", bracket };
  }

  // Step 3, friendly handle (slugified display_name).
  //
  // First ask auth-sms which user_id this handle maps to (so we have
  // it available for both the owner-stitch on the bracket response
  // AND the friendly "no bracket yet" fallback). Then hit the
  // game-service's by-handle endpoint, which resolves the handle
  // through auth-sms a second time on its side and returns the
  // owner's latest bracket.
  //
  // The legacy "look the bracket up by user_id" path was the
  // enumeration vector closed by SEC-BRK-05; we now go through
  // handles end-to-end.  Tim 2026-06-04, prod regression fix.
  if (isHandleShape(guid) && !isReservedSlug(guid)) {
    const hit = await lookupUserByHandle(guid);
    if (hit) {
      const result = await loadBracketByHandle(guid, hit.id, {
        includePayload: opts.includePayload,
      });
      if (result.kind === "user") {
        return { kind: "user", bracket: result.bracket };
      }
      // Handle is real but no saved bracket (game-service returned
      // `no_bracket`, or the call timed out and we have an
      // auth-sms-confirmed user_id to fall back on). Surface a
      // friendly view so the visitor sees who they were looking for.
      return {
        kind: "user_no_bracket",
        handle: guid,
        userId: hit.id,
        displayName: hit.displayName,
      };
    }
  }

  return { kind: "not_found", attempted: guid };
}
