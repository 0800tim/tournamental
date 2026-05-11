/**
 * Mock avatar URLs for draft leaderboards and syndicate landing pages.
 *
 * We use DiceBear's `avataaars` style intentionally: members read as
 * cartoonish, illustrated avatars, NOT as real people. This avoids the
 * "fake user" deception you'd get from headshot generators like
 * thispersondoesnotexist.com — the visual style itself communicates
 * "illustrative placeholder" without needing extra copy.
 *
 * The endpoint is public and free (no API key, no rate limit on the
 * standard /9.x/ paths) and returns a deterministic SVG given a seed.
 * That determinism is load-bearing — the same syndicate or member id
 * always renders the same face, so screenshots and demos stay stable.
 *
 * Fallback: if avataaars returns an empty SVG (it sometimes does for
 * single-character seeds), the caller can swap to `initialsAvatarUrl`,
 * which always renders a coloured monogram.
 */

const AVATAAARS_BASE = "https://api.dicebear.com/9.x/avataaars/svg";
const INITIALS_BASE = "https://api.dicebear.com/9.x/initials/svg";

/**
 * Returns a deterministic avataaars SVG URL for the given seed.
 * Seeds are usually a member handle or stable id, e.g. "@magnus_p".
 */
export function avatarUrl(seed: string): string {
  return `${AVATAAARS_BASE}?seed=${encodeURIComponent(seed)}`;
}

/**
 * Initials-style fallback. Always renders something legible — used when
 * the primary avataaars endpoint returns empty for awkwardly-short
 * seeds, or when we need a smaller payload for grids of 50+ rows.
 */
export function initialsAvatarUrl(seed: string): string {
  return `${INITIALS_BASE}?seed=${encodeURIComponent(seed)}`;
}

/**
 * Shorthand: pick the best avatar for a given seed. Defaults to
 * avataaars; opt into initials with `{ style: "initials" }`.
 */
export function pickAvatar(
  seed: string,
  opts: { style?: "avataaars" | "initials" } = {},
): string {
  return opts.style === "initials" ? initialsAvatarUrl(seed) : avatarUrl(seed);
}
