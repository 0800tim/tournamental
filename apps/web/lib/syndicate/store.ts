/**
 * Syndicate store, production SQLite-backed implementation with a
 * fallback to in-memory samples for the pre-launch hype window.
 *
 * Resolution order in `loadSyndicateBySlug`:
 *   1. SQLite row in the shared game-service DB (real signups).
 *   2. In-memory sample syndicate (so dev / preview deploys without a
 *      provisioned DB still render the `/s/<slug>` landing page).
 *   3. Return `null` → `/s/<guid>` resolver falls through to user share.
 *
 * The persistence layer for *new* syndicates lives in `persistence.ts`
 *, that's the create + retry-queue surface the signup route uses.
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

export interface SyndicatePrizeSplitEntry {
  readonly rank: number;
  readonly percent: number;
  readonly label?: string | null;
  readonly sponsor_name?: string | null;
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
  /** Branding colours / sponsor / prize copy when configured by the owner. */
  readonly branding?: {
    readonly primary_colour: string | null;
    readonly accent_colour: string | null;
    readonly logo_url: string | null;
    readonly hero_url: string | null;
  };
  readonly sponsor?: {
    readonly name: string | null;
    readonly url: string | null;
    readonly logo_url: string | null;
  } | null;
  readonly prize_text?: string | null;
  /** Entry fee (cents). `null` or `0` means "no fee, bragging rights only". */
  readonly entry_fee_cents?: number | null;
  readonly entry_fee_currency?: string | null;
  /** Decoded prize split. `null` means owner hasn't defined one. */
  readonly prize_split?: ReadonlyArray<SyndicatePrizeSplitEntry> | null;
  readonly bonus_prize_text?: string | null;
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
    tournament_label: "Football World Cup 2026 Predictor",
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
    tournament_label: "Football World Cup 2026 Predictor",
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
    tournament_label: "Football World Cup 2026 Predictor",
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
  "fifa-wc-2026": "Football World Cup 2026 Predictor",
};

/** 6-char hex tag derived from a user id, used as a stable placeholder
 * handle for joined members until the membership table grows a handle
 * column. Same input → same tag. */
function shortUserHash(userId: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < userId.length; i += 1) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(0, 6);
}

function parsePrizeSplit(json: string | null): ReadonlyArray<SyndicatePrizeSplitEntry> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((e) => {
        const obj = (e ?? {}) as Record<string, unknown>;
        const rank = Number(obj.rank);
        const percent = Number(obj.percent);
        if (!Number.isFinite(rank) || !Number.isFinite(percent)) return null;
        return {
          rank,
          percent,
          label: typeof obj.label === "string" ? obj.label : null,
          sponsor_name: typeof obj.sponsor_name === "string" ? obj.sponsor_name : null,
        } as SyndicatePrizeSplitEntry;
      })
      .filter((e): e is SyndicatePrizeSplitEntry => e !== null);
  } catch {
    return null;
  }
}

/** Render a SQLite syndicate row into the public `SyndicateRecord` shape. */
function fromPersistenceRow(row: {
  id: string;
  slug: string;
  name: string;
  tournament_id: string;
  owner_user_id: string | null;
  owner_handle: string | null;
  created_at: number;
  member_count: number;
  branding_primary_colour?: string | null;
  branding_accent_colour?: string | null;
  branding_logo_url?: string | null;
  branding_hero_url?: string | null;
  sponsor_name?: string | null;
  sponsor_url?: string | null;
  sponsor_logo_url?: string | null;
  prize_text?: string | null;
  entry_fee_cents?: number | null;
  entry_fee_currency?: string | null;
  prize_split_json?: string | null;
  bonus_prize_text?: string | null;
}): SyndicateRecord {
  const sponsorPresent = !!(row.sponsor_name || row.sponsor_logo_url);

  // Read the real membership rows from `syndicate_owners_membership`
  // rather than synthesising fake `member_1`, `member_2`, … handles from
  // `member_count`. The cached count can drift (e.g. duplicate self-joins
  // before the count guard landed) so we trust the membership table as
  // the source of truth. The handle column doesn't exist on that table
  // yet, so non-owner rows render with a stable short id derived from
  // their user_id instead of a fabricated counter.
  let realMembers: Array<{ user_id: string; role: string; joined_at: number }> = [];
  try {
    realMembers = getPersistence().getMembers(row.id);
  } catch {
    /* schema not ready in this environment; fall back to the owner row */
  }
  if (realMembers.length === 0) {
    realMembers = [
      {
        user_id: row.owner_user_id ?? `anon:${row.id}`,
        role: "owner",
        joined_at: row.created_at,
      },
    ];
  }

  return {
    slug: row.slug,
    name: row.name,
    owner_handle: row.owner_handle ?? "owner",
    owner_country_emoji: "⚽",
    tournament_id: row.tournament_id,
    tournament_label: TOURNAMENT_LABELS[row.tournament_id] ?? row.tournament_id,
    created_at: new Date(row.created_at).toISOString(),
    picks_made: 0,
    members: realMembers.map((m) => ({
      handle:
        m.role === "owner"
          ? row.owner_handle ?? "owner"
          : `member-${shortUserHash(m.user_id)}`,
      country_code: "NZL",
      flag_emoji: "🇳🇿",
      joined_at: new Date(m.joined_at).toISOString(),
      points: 0,
    })),
    branding: {
      primary_colour: row.branding_primary_colour ?? null,
      accent_colour: row.branding_accent_colour ?? null,
      logo_url: row.branding_logo_url ?? null,
      hero_url: row.branding_hero_url ?? null,
    },
    sponsor: sponsorPresent
      ? {
          name: row.sponsor_name ?? null,
          url: row.sponsor_url ?? null,
          logo_url: row.sponsor_logo_url ?? null,
        }
      : null,
    prize_text: row.prize_text ?? null,
    entry_fee_cents: row.entry_fee_cents ?? null,
    entry_fee_currency: row.entry_fee_currency ?? null,
    prize_split: parsePrizeSplit(row.prize_split_json ?? null),
    bonus_prize_text: row.bonus_prize_text ?? null,
  };
}

/**
 * Look up a syndicate by its kebab slug. Returns `null` if the slug
 * doesn't exist in either the SQLite store or the in-memory samples.
 *
 * Pure-async, safe to call from server components.
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
    // Schema not yet migrated, or the DB file is missing, fall back
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

/**
 * Look up a syndicate by its short share_guid. Used by the /s/<guid>
 * resolver to redirect legacy guid links to the canonical /s/<slug>
 * URL. Returns null if no syndicate matches.
 */
export async function loadSyndicateByShareGuid(
  shareGuid: string,
): Promise<SyndicateRecord | null> {
  const safe = shareGuid.trim();
  if (!safe) return null;
  try {
    const row = getPersistence().getByShareGuid(safe);
    if (row) return fromPersistenceRow(row);
  } catch {
    /* ignore — fall through */
  }
  return null;
}
