/**
 * ID generation helpers for syndicates.
 *
 * The slug is the user-facing handle (`/s/<slug>`). The `share_guid`
 * is an opaque alternate handle the `/s/<guid>` universal share
 * resolver also accepts (via the 16-char nanoid branch). The signup
 * route emits both on creation so any future invite flow can pick the
 * better fit.
 *
 * Why two: slugs are guessable / desirable (people want
 * "dave-and-tim" URLs); guids let us issue *signed* invites that can
 * be revoked or scoped without renaming the syndicate.
 */

import { randomBytes, randomUUID } from "node:crypto";

/** RFC-4122 v4 UUID. */
export function newSyndicateId(): string {
  return randomUUID();
}

/**
 * 16-char URL-safe random identifier. We use base36 (no `=` padding,
 * no case-confusable chars on most fonts). 16 chars of base36 is ~83
 * bits, plenty for a non-secret share token.
 */
export function newShareGuid(): string {
  for (let i = 0; i < 4; i++) {
    const buf = randomBytes(12);
    let n = BigInt(0);
    for (const b of buf) n = (n << BigInt(8)) | BigInt(b);
    const encoded = n.toString(36).padStart(16, "0");
    if (encoded.length >= 16) return encoded.slice(0, 16);
  }
  // Fallback, extremely unlikely path; pad with hex of more entropy.
  return randomBytes(12).toString("hex").slice(0, 16);
}
