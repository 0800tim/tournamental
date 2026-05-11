/**
 * Zod schemas for every tool's input and output.
 *
 * The MCP catalogue is generated from these - both for the `tools/list`
 * MCP response and the public `GET /mcp/tools` HTTP catalogue. Keep them
 * narrow: tighter schemas mean better agent prompts and safer execution.
 *
 * NZ English; no em-dashes (CLAUDE.md). Apache-2.0.
 */

import { z } from 'zod';

// ---------- Shared atoms ----------

export const TeamCode = z
  .string()
  .regex(/^[A-Z]{3}$/, 'team code must be a three-letter ISO-like code, e.g. ARG')
  .describe('Three-letter ISO-3166-ish team code, upper-case');

export const TournamentId = z
  .string()
  .min(1)
  .describe('Canonical tournament id, e.g. "fifa-wc-2026"');

export const Guid = z
  .string()
  .regex(/^[0-9a-fA-F-]{8,64}$/, 'guid looks like a 16-32 char hex / dash string')
  .describe('Public share guid for a saved bracket');

export const MatchId = z
  .string()
  .min(1)
  .describe('Canonical fixture id, e.g. "r32_01", "qf_01", "final"');

export const Outcome = z
  .enum(['home_win', 'away_win', 'draw'])
  .describe('Match outcome from the home side\'s perspective');

export const SyndicateSlug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'lower-case kebab-case slug')
  .describe('Path-safe syndicate slug used at play.tournamental.com/s/<slug>');

export const UserKey = z
  .string()
  .min(16)
  .describe('Per-user API key (also accepted via Authorization: Bearer)');

export const AdminKey = z
  .string()
  .min(24)
  .describe('Admin API key (also accepted via X-Tournamental-Admin-Key)');

// ---------- get_team ----------

export const GetTeamInput = z.object({
  teamCode: TeamCode,
});

export const GetTeamOutput = z.object({
  team_code: TeamCode,
  name: z.string(),
  fifa_rank: z.number().int().nullable(),
  flag_emoji: z.string().nullable(),
  confederation: z.string().nullable(),
  kit: z
    .object({
      home_primary: z.string(),
      home_secondary: z.string(),
      away_primary: z.string(),
      away_secondary: z.string(),
    })
    .nullable(),
});

// ---------- get_tournament ----------

export const GetTournamentInput = z
  .object({
    tournamentId: TournamentId.optional(),
  })
  .describe('Tournament lookup. Defaults to the current WC 2026 tournament.');

export const GetTournamentOutput = z.object({
  tournament_id: TournamentId,
  name: z.string(),
  status: z.enum(['draft', 'preview', 'live', 'concluded']),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  groups: z.array(
    z.object({
      group_id: z.string(),
      teams: z.array(TeamCode),
    }),
  ),
  fixture_count: z.number().int().nonnegative(),
  knockout_locked: z.boolean(),
});

// ---------- get_leaderboard ----------

export const LeaderboardScope = z.enum(['global', 'syndicate', 'friends']);

export const GetLeaderboardInput = z
  .object({
    tournamentId: TournamentId,
    scope: LeaderboardScope.default('global'),
    syndicateSlug: SyndicateSlug.optional(),
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().nonnegative().default(0),
  })
  .refine(
    (v) => v.scope !== 'syndicate' || !!v.syndicateSlug,
    { message: 'syndicateSlug is required when scope=syndicate', path: ['syndicateSlug'] },
  );

export const GetLeaderboardOutput = z.object({
  tournament_id: TournamentId,
  scope: LeaderboardScope,
  syndicate_slug: SyndicateSlug.nullable(),
  preview: z
    .boolean()
    .describe(
      'True until the first match has kicked off. Ranks are mock/illustrative until then.',
    ),
  rows: z.array(
    z.object({
      rank: z.number().int().positive(),
      user_handle: z.string().nullable(),
      score_total: z.number(),
      bracket_share_guid: Guid.nullable(),
    }),
  ),
  total: z.number().int().nonnegative(),
});

// ---------- get_bracket_by_guid ----------

export const GetBracketByGuidInput = z.object({
  guid: Guid,
  includePayload: z.boolean().default(false),
});

export const KnockoutPathEntry = z.object({
  stage: z.enum(['r32', 'r16', 'qf', 'sf', 'final']),
  match_id: z.string(),
  pick_code: TeamCode.nullable(),
});

export const GetBracketByGuidOutput = z.object({
  share_guid: Guid,
  user_handle: z.string().nullable(),
  tournament_id: TournamentId,
  champion_code: TeamCode.nullable(),
  runner_up_code: TeamCode.nullable(),
  third_place_code: TeamCode.nullable(),
  knockout_path: z.array(KnockoutPathEntry),
  locked_at: z.string().nullable(),
  payload: z.record(z.any()).optional(),
});

// ---------- get_syndicate ----------

export const GetSyndicateInput = z.object({
  slug: SyndicateSlug,
});

export const GetSyndicateOutput = z.object({
  slug: SyndicateSlug,
  display_name: z.string(),
  description: z.string().nullable(),
  member_count: z.number().int().nonnegative(),
  created_at: z.string().nullable(),
  share_url: z.string().url(),
  // No PII (no member handles, no contact info) - this is a public surface.
});

// ---------- get_match_path ----------

export const GetMatchPathInput = z.object({
  teamCode: TeamCode,
  tournamentId: TournamentId.optional(),
});

export const GetMatchPathOutput = z.object({
  team_code: TeamCode,
  tournament_id: TournamentId,
  steps: z.array(
    z.object({
      stage: z.enum(['group', 'r32', 'r16', 'qf', 'sf', 'final']),
      match_id: MatchId,
      opponent_code: TeamCode.nullable(),
      kickoff_at: z.string().nullable(),
    }),
  ),
  champion_path_complete: z.boolean(),
});

// ---------- query_molecule ----------

export const QueryMoleculeInput = z.object({
  bracketGuid: Guid,
});

export const MoleculeAtom = z.object({
  atom_id: z.string(),
  stage: z.enum(['group', 'r32', 'r16', 'qf', 'sf', 'final']),
  match_id: MatchId,
  predicted_winner: TeamCode.nullable(),
  predicted_score_home: z.number().int().nullable(),
  predicted_score_away: z.number().int().nullable(),
});

export const MoleculeBond = z.object({
  from_atom: z.string(),
  to_atom: z.string(),
  bond_type: z.enum(['advances', 'feeds', 'shares-pool']),
});

export const QueryMoleculeOutput = z.object({
  bracket_guid: Guid,
  atom_count: z.number().int().nonnegative(),
  atoms: z.array(MoleculeAtom),
  bonds: z.array(MoleculeBond),
});

// ---------- submit_bracket ----------

export const BracketPayload = z
  .object({
    tournamentId: TournamentId,
    groupPredictions: z.record(z.any()).optional(),
    knockoutPredictions: z.record(z.any()).optional(),
    metadata: z.record(z.any()).optional(),
  })
  .describe('Full bracket payload - same shape that POST /v1/bracket/submit accepts.');

export const SubmitBracketInput = z.object({
  userKey: UserKey.optional(),
  bracket: BracketPayload,
});

export const SubmitBracketOutput = z.object({
  bracket_id: z.string(),
  share_guid: Guid,
  locked_at: z.string().nullable(),
  score_preview: z.number().nullable(),
});

// ---------- update_pick ----------

export const UpdatePickInput = z.object({
  userKey: UserKey.optional(),
  matchId: MatchId,
  outcome: Outcome,
  scoreHome: z.number().int().min(0).max(99).optional(),
  scoreAway: z.number().int().min(0).max(99).optional(),
});

export const UpdatePickOutput = z.object({
  match_id: MatchId,
  outcome: Outcome,
  locked: z.boolean(),
  locked_at: z.string().nullable(),
});

// ---------- lock_picks ----------

export const LockPicksInput = z.object({
  userKey: UserKey.optional(),
  untilMatchId: MatchId.optional(),
});

export const LockPicksOutput = z.object({
  locked_count: z.number().int().nonnegative(),
  locked_at: z.string(),
});

// ---------- save_share_guid ----------

export const SaveShareGuidInput = z.object({
  userKey: UserKey.optional(),
  shareGuid: Guid,
});

export const SaveShareGuidOutput = z.object({
  share_guid: Guid,
  adopted: z.boolean(),
});

// ---------- set_handle ----------

export const SetHandleInput = z.object({
  userKey: UserKey.optional(),
  handle: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z0-9_-]+$/i, 'handles are alphanumeric, underscore, hyphen'),
});

export const SetHandleOutput = z.object({
  handle: z.string(),
  accepted: z.boolean(),
  rejection_reason: z.enum(['profane', 'taken', 'too-short', 'too-long']).nullable(),
});

// ---------- admin_resolve_match ----------

export const AdminResolveMatchInput = z.object({
  adminKey: AdminKey.optional(),
  matchId: MatchId,
  outcome: Outcome,
  scoreHome: z.number().int().min(0).max(99),
  scoreAway: z.number().int().min(0).max(99),
});

export const AdminResolveMatchOutput = z.object({
  match_id: MatchId,
  outcome: Outcome,
  score_home: z.number().int(),
  score_away: z.number().int(),
  resolved_at: z.string(),
  affected_brackets: z.number().int().nonnegative(),
});

// ---------- admin_list_pending_users ----------

export const AdminListPendingUsersInput = z.object({
  adminKey: AdminKey.optional(),
  limit: z.number().int().min(1).max(500).default(50),
});

export const AdminListPendingUsersOutput = z.object({
  rows: z.array(
    z.object({
      user_id: z.string(),
      handle: z.string().nullable(),
      created_at: z.string(),
      flagged_reason: z.string().nullable(),
    }),
  ),
  total: z.number().int().nonnegative(),
});

// ---------- admin_invalidate_share ----------

export const AdminInvalidateShareInput = z.object({
  adminKey: AdminKey.optional(),
  guid: Guid,
  reason: z.string().max(280).optional(),
});

export const AdminInvalidateShareOutput = z.object({
  guid: Guid,
  revoked: z.boolean(),
  revoked_at: z.string(),
});
