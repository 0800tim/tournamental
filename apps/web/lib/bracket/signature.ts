/**
 * Bracket signature, a stable fingerprint used by autosave
 * dirty-detectors to decide whether the local bracket has drifted
 * from the last server-known state.
 *
 * Deliberately ignores `bracketId`, `lockedAt`, and `version` so a
 * round-trip through the server (which may stamp those) doesn't show
 * up as a dirty diff.
 *
 * Tim 2026-06-05: lived inline in BracketBuilder; extracted on
 * 2026-06-12 so the calendar picker surface can share the same
 * fingerprint without duplicating the rule.
 */

import type { Bracket } from "@tournamental/bracket-engine";

export function bracketSignature(b: Bracket): string {
  return JSON.stringify({
    m: b.matchPredictions ?? {},
    k: b.knockoutPredictions ?? {},
    g: b.groupTiebreakers ?? {},
    t: b.bestThirds ?? [],
  });
}
