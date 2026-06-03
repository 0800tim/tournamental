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

  // Step 3, friendly handle (slugified display_name). Ask auth-sms
  // which user_id this handle maps to, then reuse the existing
  // by-user-id fallback in loadBracketFromGuid (which accepts the
  // `u_<hex>` shape after PR 4059281).
  if (isHandleShape(guid) && !isReservedSlug(guid)) {
    const hit = await lookupUserByHandle(guid);
    if (hit) {
      const bracket = await loadBracketFromGuid(hit.id, {
        includePayload: opts.includePayload,
      });
      if (bracket) return { kind: "user", bracket };
      // Handle is real but no saved bracket; surface a friendly view
      // so the visitor sees who they were looking for and the nudge
      // to share their own picks.
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
