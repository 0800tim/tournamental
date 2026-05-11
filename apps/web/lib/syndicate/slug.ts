/**
 * Syndicate slug derivation helpers (extending `reserved-slugs.ts`).
 *
 * The shape validator + reserved-slug detector live in
 * `reserved-slugs.ts` because the share-landing resolver already
 * imports from there. This module adds:
 *
 *   - `deriveSlug(name)` — best-effort kebab-case from a human name
 *   - `validateSlug(slug)` — combined shape + reserved check
 *   - constants `SLUG_MIN_LEN` / `SLUG_MAX_LEN`
 *
 * The shape: 3-40 chars, lowercase letters / digits, single hyphens
 * only, no leading/trailing hyphen, no consecutive hyphens. See
 * `isValidSlugShape` in `reserved-slugs.ts` for the exact regex.
 */

import { isReservedSlug, isValidSlugShape } from "./reserved-slugs";

export const SLUG_MIN_LEN = 3;
export const SLUG_MAX_LEN = 40;

// Re-export for convenience so importers can pull both from this file.
export { isReservedSlug, isValidSlugShape };

/**
 * Result of `validateSlug` — separates "the slug *cannot* be used at
 * all" (invalid / reserved) from "ok-so-far, still need the DB lookup".
 */
export function validateSlug(slug: string):
  | { ok: true }
  | { ok: false; reason: "invalid" | "reserved" } {
  if (!isValidSlugShape(slug)) return { ok: false, reason: "invalid" };
  if (isReservedSlug(slug)) return { ok: false, reason: "reserved" };
  return { ok: true };
}

/**
 * Derive a slug from a syndicate name. Best-effort — the user can edit
 * the result in the form before submit. Strips accents, lowercases,
 * replaces every run of non-[a-z0-9] with a single hyphen, and trims
 * leading/trailing hyphens. Truncates to `SLUG_MAX_LEN`.
 *
 * Because the shape validator rejects consecutive hyphens, we collapse
 * any run of separators down to a single `-` rather than leaving the
 * raw conversion result.
 *
 * Returns "" if the input contains no slug-eligible chars; the form
 * should treat that as "user needs to enter their own slug".
 */
export function deriveSlug(name: string): string {
  if (typeof name !== "string") return "";
  // Strip combining marks (NFD splits "é" into "e" + accent; the regex
  // then drops the accent).
  const noAccents = name.normalize("NFD").replace(/\p{M}+/gu, "");
  const lowered = noAccents.toLowerCase();
  // Replace every run of disallowed chars with a single hyphen.
  const hyphenated = lowered.replace(/[^a-z0-9]+/g, "-");
  // Trim leading/trailing hyphens.
  const trimmed = hyphenated.replace(/^-+|-+$/g, "");
  if (!trimmed) return "";
  if (trimmed.length <= SLUG_MAX_LEN) return trimmed;
  // Truncate at SLUG_MAX_LEN, then re-trim any trailing hyphen exposed
  // by the cut so the result still ends with [a-z0-9].
  return trimmed.slice(0, SLUG_MAX_LEN).replace(/-+$/g, "");
}
