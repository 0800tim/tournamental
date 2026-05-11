/**
 * In-memory syndicate store — STUB pending the real backend.
 *
 * Why this exists: the `/s/<guid>` universal share landing route needs
 * a syndicate lookup that returns *something* renderable so the page
 * has a real shape during pre-launch. The parallel syndicate-signup
 * agent (#70) is wiring the production store onto the game-service;
 * when that lands, this file gets swapped for a thin client.
 *
 * The shape exported here IS the contract — the backend implementation
 * MUST satisfy `SyndicateRecord` and `loadSyndicateBySlug`, otherwise
 * the share landing page breaks. Treat changes to `SyndicateRecord`
 * as a breaking-API change and coordinate with agent #70.
 *
 * Cache policy: pure in-memory, no caching layer; the calling route
 * sets `Cache-Control: public, s-maxage=60, stale-while-revalidate=600`
 * so a stale leaderboard never blocks the page.
 */

export interface SyndicateMember {
  readonly handle: string;
  readonly country_code: string; // ISO-3 (e.g. "ARG", "NZL", "USA")
  readonly flag_emoji: string;
  readonly joined_at: string; // ISO-8601
  /** Points-on-the-board once the tournament starts. Pre-kickoff = 0. */
  readonly points: number;
}

export interface SyndicateRecord {
  readonly slug: string;
  readonly name: string;
  readonly owner_handle: string;
  readonly owner_country_emoji: string;
  readonly tournament_id: string;
  readonly tournament_label: string;
  readonly created_at: string;
  readonly picks_made: number;
  readonly members: ReadonlyArray<SyndicateMember>;
}

// Three sample syndicates so the route renders something during the
// pre-launch hype window. These are deliberately recognisable names so
// QA can sanity-check the page in dev.
const SAMPLE_SYNDICATES: ReadonlyArray<SyndicateRecord> = [
  {
    slug: "argentina-pool",
    name: "Argentina Pool",
    owner_handle: "messi_picks",
    owner_country_emoji: "🇦🇷",
    tournament_id: "fifa-wc-2026",
    tournament_label: "FIFA World Cup 2026",
    created_at: "2026-04-12T09:00:00Z",
    picks_made: 47,
    members: [
      { handle: "messi_picks", country_code: "ARG", flag_emoji: "🇦🇷", joined_at: "2026-04-12T09:00:00Z", points: 0 },
      { handle: "di_maria", country_code: "ARG", flag_emoji: "🇦🇷", joined_at: "2026-04-12T11:24:00Z", points: 0 },
      { handle: "buenos_aires_42", country_code: "ARG", flag_emoji: "🇦🇷", joined_at: "2026-04-13T07:18:00Z", points: 0 },
      { handle: "rosario_red", country_code: "ARG", flag_emoji: "🇦🇷", joined_at: "2026-04-14T15:55:00Z", points: 0 },
      { handle: "cordoba_kid", country_code: "ARG", flag_emoji: "🇦🇷", joined_at: "2026-04-16T20:01:00Z", points: 0 },
      { handle: "mendoza_max", country_code: "ARG", flag_emoji: "🇦🇷", joined_at: "2026-04-18T12:00:00Z", points: 0 },
      { handle: "wellington_w", country_code: "NZL", flag_emoji: "🇳🇿", joined_at: "2026-04-19T03:22:00Z", points: 0 },
      { handle: "miami_messi", country_code: "USA", flag_emoji: "🇺🇸", joined_at: "2026-04-20T18:09:00Z", points: 0 },
    ],
  },
  {
    slug: "tim-friends",
    name: "Tim & Friends",
    owner_handle: "tim",
    owner_country_emoji: "🇳🇿",
    tournament_id: "fifa-wc-2026",
    tournament_label: "FIFA World Cup 2026",
    created_at: "2026-04-28T22:14:00Z",
    picks_made: 12,
    members: [
      { handle: "tim", country_code: "NZL", flag_emoji: "🇳🇿", joined_at: "2026-04-28T22:14:00Z", points: 0 },
      { handle: "sam_d", country_code: "NZL", flag_emoji: "🇳🇿", joined_at: "2026-04-29T08:01:00Z", points: 0 },
      { handle: "kate_h", country_code: "AUS", flag_emoji: "🇦🇺", joined_at: "2026-04-30T19:37:00Z", points: 0 },
      { handle: "ben_w", country_code: "GBR", flag_emoji: "🇬🇧", joined_at: "2026-05-01T11:22:00Z", points: 0 },
    ],
  },
  {
    slug: "dunedin-locals",
    name: "Dunedin Locals",
    owner_handle: "otago_otto",
    owner_country_emoji: "🇳🇿",
    tournament_id: "fifa-wc-2026",
    tournament_label: "FIFA World Cup 2026",
    created_at: "2026-05-02T06:30:00Z",
    picks_made: 0,
    members: [
      { handle: "otago_otto", country_code: "NZL", flag_emoji: "🇳🇿", joined_at: "2026-05-02T06:30:00Z", points: 0 },
    ],
  },
];

const STORE = new Map<string, SyndicateRecord>(
  SAMPLE_SYNDICATES.map((s) => [s.slug, s]),
);

/**
 * Look up a syndicate by its kebab slug. Returns `null` if the slug
 * doesn't exist. Pure function over the in-memory map — safe to call
 * from server components.
 *
 * TODO(#70): replace with a fetch to game-service
 *   `GET /v1/syndicates/by-slug/<slug>` once that endpoint ships.
 */
export async function loadSyndicateBySlug(
  slug: string,
): Promise<SyndicateRecord | null> {
  const safe = slug.trim().toLowerCase();
  if (!safe) return null;
  return STORE.get(safe) ?? null;
}

/**
 * Test-only helper: register a synthetic syndicate. Used by the
 * `/s/[guid]` page tests to assert resolver behaviour against
 * deterministic fixtures. Not exported from the production index;
 * consumers should never call this in real code.
 */
export function __unsafe_register_syndicate_for_tests(
  record: SyndicateRecord,
): void {
  STORE.set(record.slug, record);
}
