/**
 * Friendly-handle slug rules for /s/<handle> share URLs.
 *
 * The web client slugifies the authed user's display_name with these
 * rules and uses the result as the share URL when it's clean enough to
 * read. The resolver applies the exact same rules in reverse: take the
 * incoming /s/<segment>, normalise to the slug shape, and ask auth-sms
 * which user that maps to.
 *
 * Slugification rules (deliberately conservative, optimised for
 * "looks legit shared in a tweet"):
 *
 *   - lowercase everything
 *   - keep `[a-z0-9_-]`, strip everything else (spaces, dots, emoji,
 *     accented characters, punctuation)
 *   - 2..32 chars
 *
 * Tim 2026-05-24. The first-pass v0.1 collision policy is "most
 * recently active user wins" (enforced in auth-sms/storage.ts
 * getUserByHandle). A dedicated immutable handle column with
 * uniqueness-at-signup is the v0.2 path; this module's rules become
 * the slugifier for the rename-detection step there too.
 */

import { isReservedSlug } from "@/lib/syndicate/reserved-slugs";

/** Convert any display_name into a URL-safe handle. Returns `null`
 *  when the result is too short, too long, or reserved. */
export function slugifyDisplayName(displayName: string | null | undefined): string | null {
  if (!displayName) return null;
  const normalised = displayName
    .toLowerCase()
    .normalize("NFKD")              // strip accents (é → e)
    .replace(/[̀-ͯ]/g, "") // combining marks
    .replace(/[^a-z0-9_-]/g, "");
  if (normalised.length < 2 || normalised.length > 32) return null;
  if (isReservedSlug(normalised)) return null;
  // Avoid handle shapes that collide with our other share-guid shapes
  // (UUID v4, 16-char nanoid, auth-sms u_<hex>). If the slug already
  // matches one of these, fall back to the guid form so the resolver
  // doesn't have to guess.
  if (/^[0-9a-f]{16}$/.test(normalised)) return null;
  if (/^u_[0-9a-f]{16,32}$/.test(normalised)) return null;
  return normalised;
}

/** Cheap shape check used by the resolver — does this look like a
 *  handle we should try? Distinguishes from share-guids + UUIDs by
 *  shape so the resolver can dispatch without a wasted lookup. */
export function isHandleShape(s: string): boolean {
  if (typeof s !== "string") return false;
  if (s.length < 2 || s.length > 32) return false;
  if (!/^[a-z0-9_-]+$/i.test(s)) return false;
  // Exclude the share-guid + auth-sms-user shapes; those have their
  // own resolver branches.
  if (/^[0-9a-f]{16}$/i.test(s)) return false;
  if (/^u_[0-9a-f]{16,32}$/i.test(s)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) return false;
  return true;
}
