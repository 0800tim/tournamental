/**
 * Reserved slugs for the `/s/<guid>` universal share landing surface.
 *
 * A "syndicate" is a private prediction pool a user creates and shares
 * via `/s/<slug>` (e.g. `/s/tim-friends`, `/s/dunedin-locals`). To keep
 * those URLs human-friendly we run a slug lookup BEFORE the user-share
 * UUID lookup in `apps/web/app/s/[guid]/page.tsx`.
 *
 * That means we have to reserve any slug a real tournament or product
 * surface might want to claim — otherwise a squatter would block us
 * from shipping `/s/nba` or `/s/world-cup` later. This list is the
 * single source of truth; the parallel syndicate-signup agent (#70)
 * imports it at signup time to refuse these names.
 *
 * Add new entries here when:
 *   - a new tournament/league surface gets a top-level area, or
 *   - a new product route would clash with the share path.
 *
 * Keep entries lowercase, hyphen-only. Matching is case-insensitive
 * via `isReservedSlug`.
 */

export const RESERVED_SLUGS: ReadonlyArray<string> = [
  // tournaments / leagues we may surface as top-level
  "nba",
  "ufc",
  "world-cup",
  "nfl",
  "nrl",
  "mlb",
  "nhl",
  "t20",
  "ipl",
  "six-nations",
  "super-bowl",
  "premier-league",
  // product / routing reserved words
  "play",
  "s",
  "api",
  "admin",
  "signup",
  "login",
  "auth",
  "home",
  "app",
  "www",
  "mail",
  "email",
  "support",
  "help",
  "about",
  "terms",
  "privacy",
  "legal",
  "tournamental",
] as const;

const RESERVED_SET = new Set(RESERVED_SLUGS.map((s) => s.toLowerCase()));

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SET.has(slug.trim().toLowerCase());
}

/**
 * Pure-function slug shape validator. A valid syndicate slug is:
 *   - 3..40 chars total
 *   - lowercase letters, digits, hyphens only
 *   - no leading/trailing hyphen
 *   - no consecutive hyphens
 *
 * This is intentionally narrower than a generic slug regex so that
 * the syndicate namespace stays predictable for URL sharing — a slug
 * read out loud over a podcast should be unambiguous.
 */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$/;

export function isValidSlugShape(slug: string): boolean {
  if (typeof slug !== "string") return false;
  if (slug.length < 3 || slug.length > 40) return false;
  return SLUG_RE.test(slug);
}
