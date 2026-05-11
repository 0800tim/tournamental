/**
 * Syndicate store — production SQLite-backed implementation with a
 * fallback to in-memory samples for the pre-launch hype window.
 *
 * Resolution order in `loadSyndicateBySlug`:
 *   1. SQLite row in the shared game-service DB (real signups).
 *   2. In-memory sample syndicate (so dev / preview deploys without a
 *      provisioned DB still render the `/s/<slug>` landing page).
 *   3. Return `null` → `/s/<guid>` resolver falls through to user share.
 *
 * The persistence layer for *new* syndicates lives in `persistence.ts`
 * — that's the create + retry-queue surface the signup route uses.
 * Keeping the read-only stub here in `store.ts` preserves the contract
 * the `/s/[guid]` share landing depends on (it imports
 * `SyndicateRecord` + `loadSyndicateBySlug` from this file).
 */

import { getPersistence } from "./persistence";

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

const SAMPLE_BY_SLUG = new Map<string, SyndicateRecord>(
  SAMPLE_SYNDICATES.map((s) => [s.slug, s]),
);

// In-memory overrides used by tests via __unsafe_register_syndicate_for_tests.
const TEST_OVERRIDES = new Map<string, SyndicateRecord>();

const TOURNAMENT_LABELS: Record<string, string> = {
  "fifa-wc-2026": "FIFA World Cup 2026",
};

/** Render a SQLite syndicate row into the public `SyndicateRecord` shape. */
function fromPersistenceRow(row: {
  slug: string;
  name: string;
  tournament_id: string;
  owner_handle: string | null;
  created_at: number;
  member_count: number;
}): SyndicateRecord {
  return {
    slug: row.slug,
    name: row.name,
    owner_handle: row.owner_handle ?? "owner",
    owner_country_emoji: "🌍",
    tournament_id: row.tournament_id,
    tournament_label: TOURNAMENT_LABELS[row.tournament_id] ?? row.tournament_id,
    created_at: new Date(row.created_at).toISOString(),
    picks_made: 0,
    // Real member fan-out lands post-launch (parallel agent #67 owns
    // the landing page). For now the count is `member_count` rendered
    // as a single placeholder so the page renders.
    members: Array.from({ length: Math.max(1, row.member_count) }, (_, i) => ({
      handle: i === 0 ? row.owner_handle ?? "owner" : `member_${i}`,
      country_code: "NZL",
      flag_emoji: "🇳🇿",
      joined_at: new Date(row.created_at).toISOString(),
      points: 0,
    })),
  };
}

/**
 * Look up a syndicate by its kebab slug. Returns `null` if the slug
 * doesn't exist in either the SQLite store or the in-memory samples.
 *
 * Pure-async — safe to call from server components.
 */
export async function loadSyndicateBySlug(
  slug: string,
): Promise<SyndicateRecord | null> {
  const safe = slug.trim().toLowerCase();
  if (!safe) return null;
  // Test overrides win for deterministic resolver tests.
  const override = TEST_OVERRIDES.get(safe);
  if (override) return override;
  // Real DB row.
  try {
    const row = getPersistence().getBySlug(safe);
    if (row) {
      return fromPersistenceRow(row);
    }
  } catch (err) {
    // Schema not yet migrated, or the DB file is missing — fall back
    // to the sample data so dev previews keep working.
    // eslint-disable-next-line no-console
    console.warn("syndicate db lookup failed; falling back to samples", err);
  }
  return SAMPLE_BY_SLUG.get(safe) ?? null;
}

/**
 * Test-only helper: register a synthetic syndicate. Used by the
 * `/s/[guid]` page tests to assert resolver behaviour against
 * deterministic fixtures. Not exported from any public surface;
 * consumers should never call this in real code.
 */
export function __unsafe_register_syndicate_for_tests(
  record: SyndicateRecord,
): void {
  TEST_OVERRIDES.set(record.slug, record);
}
