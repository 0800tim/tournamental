/**
 * Resolver for the `/s/<guid>` universal share path.
 *
 * Resolution order (matches the contract Tim laid out 2026-05-11):
 *   1. If the guid is a valid (non-reserved) syndicate slug AND a
 *      syndicate exists in the store under that slug → "syndicate".
 *   2. Else if the guid is a valid share-guid shape (UUID v4 or
 *      16-char nanoid) AND a bracket loads → "user".
 *   3. Else → "not_found".
 *
 * Crucially, reserved slugs never short-circuit to either branch:
 *   `/s/play`, `/s/api`, `/s/world-cup` always 404 in this resolver.
 *   The parallel signup agent (#70) refuses these at registration.
 *
 * This file is pure logic over the two store stubs so it's trivially
 * unit-testable. See `__tests__/s-guid-resolver.test.ts`.
 */

import {
  loadBracketFromGuid,
  isShareGuidShape,
  type BracketByGuid,
} from "@/lib/bracket/by-guid";
import { loadSyndicateBySlug, type SyndicateRecord } from "@/lib/syndicate/store";
import {
  isReservedSlug,
  isValidSlugShape,
} from "@/lib/syndicate/reserved-slugs";

export type ResolvedShare =
  | { readonly kind: "syndicate"; readonly syndicate: SyndicateRecord }
  | { readonly kind: "user"; readonly bracket: BracketByGuid }
  | { readonly kind: "not_found"; readonly attempted: string };

export async function resolveShareGuid(raw: string): Promise<ResolvedShare> {
  const guid = (raw ?? "").trim();
  if (!guid) return { kind: "not_found", attempted: raw };

  // Step 1 — syndicate slug. Only attempt if the shape is a valid slug
  // and the name is NOT reserved. A reserved slug never resolves here.
  if (isValidSlugShape(guid) && !isReservedSlug(guid)) {
    const syndicate = await loadSyndicateBySlug(guid);
    if (syndicate) return { kind: "syndicate", syndicate };
  }

  // Step 2 — user share guid. UUID v4 or 16-char nanoid.
  if (isShareGuidShape(guid)) {
    const bracket = await loadBracketFromGuid(guid);
    if (bracket) return { kind: "user", bracket };
  }

  return { kind: "not_found", attempted: guid };
}
