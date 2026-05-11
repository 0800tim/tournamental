/**
 * Tool catalogue - single source of truth for every MCP tool we expose.
 *
 * Adding a tool: append an entry below. Both the MCP `tools/list`
 * response and the public `GET /mcp/tools` HTTP catalogue are
 * generated from this list, so define a tool once and both surfaces
 * pick it up.
 *
 * Each entry carries:
 *   - name:        snake_case tool id surfaced to agents
 *   - tier:        'public' | 'user' | 'admin'
 *   - title:       human-readable label
 *   - description: ≤ 280 char tool-pick prompt for the agent
 *   - inputSchema, outputSchema: zod schemas (see ../lib/schemas.ts)
 *   - handler:     `(input, ctx) => Promise<output>`
 */

import { z, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  AdminInvalidateShareInput,
  AdminInvalidateShareOutput,
  AdminListPendingUsersInput,
  AdminListPendingUsersOutput,
  AdminResolveMatchInput,
  AdminResolveMatchOutput,
  GetBracketByGuidInput,
  GetBracketByGuidOutput,
  GetLeaderboardInput,
  GetLeaderboardOutput,
  GetMatchPathInput,
  GetMatchPathOutput,
  GetSyndicateInput,
  GetSyndicateOutput,
  GetTeamInput,
  GetTeamOutput,
  GetTournamentInput,
  GetTournamentOutput,
  LockPicksInput,
  LockPicksOutput,
  QueryMoleculeInput,
  QueryMoleculeOutput,
  SaveShareGuidInput,
  SaveShareGuidOutput,
  SetHandleInput,
  SetHandleOutput,
  SubmitBracketInput,
  SubmitBracketOutput,
  UpdatePickInput,
  UpdatePickOutput,
} from '../lib/schemas.js';
import type { GameClient } from '../lib/game-client.js';
import type { Tier } from '../lib/rate-limit.js';

export interface ToolContext {
  readonly gameClient: GameClient;
  readonly userKey: string | null;
  readonly adminKey: string | null;
  readonly ip: string | null;
}

export interface ToolDefinition<I extends ZodTypeAny, O extends ZodTypeAny> {
  readonly name: string;
  readonly tier: Tier;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: I;
  readonly outputSchema: O;
  readonly handler: (input: z.infer<I>, ctx: ToolContext) => Promise<z.infer<O>>;
}

const DEFAULT_TOURNAMENT_ID = 'fifa-wc-2026';

// ---------- Public tools ----------

export const getTeamTool: ToolDefinition<typeof GetTeamInput, typeof GetTeamOutput> = {
  name: 'get_team',
  tier: 'public',
  title: 'Get team metadata',
  description:
    'Fetch a national team\'s metadata by three-letter code: display name, FIFA rank, flag emoji, confederation, and kit colours. No auth required.',
  inputSchema: GetTeamInput,
  outputSchema: GetTeamOutput,
  async handler(input, ctx) {
    const raw = (await ctx.gameClient.getTeam(input.teamCode)) as Record<string, unknown>;
    return GetTeamOutput.parse({
      team_code: input.teamCode,
      name: (raw.name as string) ?? input.teamCode,
      fifa_rank: (raw.fifa_rank as number | null) ?? null,
      flag_emoji: (raw.flag_emoji as string | null) ?? null,
      confederation: (raw.confederation as string | null) ?? null,
      kit: (raw.kit as GetTeamOutputKit) ?? null,
    });
  },
};

type GetTeamOutputKit = z.infer<typeof GetTeamOutput>['kit'];

export const getTournamentTool: ToolDefinition<
  typeof GetTournamentInput,
  typeof GetTournamentOutput
> = {
  name: 'get_tournament',
  tier: 'public',
  title: 'Get tournament state',
  description:
    'Current tournament state: id, name, status (draft/preview/live/concluded), kickoff window, groups, fixture count, and whether the knockouts are locked. Defaults to FIFA World Cup 2026.',
  inputSchema: GetTournamentInput,
  outputSchema: GetTournamentOutput,
  async handler(input, ctx) {
    const tournamentId = input.tournamentId ?? DEFAULT_TOURNAMENT_ID;
    const raw = (await ctx.gameClient.getTournament(tournamentId)) as Record<string, unknown>;
    return GetTournamentOutput.parse({
      tournament_id: tournamentId,
      name: (raw.name as string) ?? tournamentId,
      status: (raw.status as 'draft' | 'preview' | 'live' | 'concluded') ?? 'preview',
      starts_at: (raw.starts_at as string | null) ?? null,
      ends_at: (raw.ends_at as string | null) ?? null,
      groups: (raw.groups as Array<{ group_id: string; teams: string[] }>) ?? [],
      fixture_count: (raw.fixture_count as number) ?? 0,
      knockout_locked: (raw.knockout_locked as boolean) ?? false,
    });
  },
};

export const getLeaderboardTool: ToolDefinition<
  typeof GetLeaderboardInput,
  typeof GetLeaderboardOutput
> = {
  name: 'get_leaderboard',
  tier: 'public',
  title: 'Get leaderboard',
  description:
    'Ranked list of bracket scores. Scope is global (default), syndicate (requires syndicateSlug), or friends (requires the calling user-key). Rows are flagged preview=true until the first match kicks off.',
  inputSchema: GetLeaderboardInput,
  outputSchema: GetLeaderboardOutput,
  async handler(input, ctx) {
    const raw = (await ctx.gameClient.getLeaderboard(
      input.tournamentId,
      input.scope,
      input.syndicateSlug,
      input.limit,
      input.offset,
      ctx.userKey ?? undefined,
    )) as Record<string, unknown>;
    const rows = (raw.rows as Array<Record<string, unknown>>) ?? [];
    return GetLeaderboardOutput.parse({
      tournament_id: input.tournamentId,
      scope: input.scope,
      syndicate_slug: input.syndicateSlug ?? null,
      preview: (raw.preview as boolean) ?? true,
      rows: rows.map((r, i) => ({
        rank: (r.rank as number) ?? input.offset + i + 1,
        user_handle: (r.user_handle as string | null) ?? null,
        score_total: (r.score_total as number) ?? 0,
        bracket_share_guid: (r.bracket_share_guid as string | null) ?? null,
      })),
      total: (raw.total as number) ?? rows.length,
    });
  },
};

export const getBracketByGuidTool: ToolDefinition<
  typeof GetBracketByGuidInput,
  typeof GetBracketByGuidOutput
> = {
  name: 'get_bracket_by_guid',
  tier: 'public',
  title: 'Get bracket by share guid',
  description:
    'Resolve a public share guid to its bracket summary: champion, runner-up, third place, knockout path, locked-at. Set includePayload=true to also return the full saved bracket payload (used by the molecule renderer).',
  inputSchema: GetBracketByGuidInput,
  outputSchema: GetBracketByGuidOutput,
  async handler(input, ctx) {
    const raw = (await ctx.gameClient.getBracketByGuid(
      input.guid,
      input.includePayload,
    )) as Record<string, unknown>;
    return GetBracketByGuidOutput.parse({
      share_guid: input.guid,
      user_handle: (raw.user_handle as string | null) ?? null,
      tournament_id: (raw.tournament_id as string) ?? DEFAULT_TOURNAMENT_ID,
      champion_code: (raw.champion_code as string | null) ?? null,
      runner_up_code: (raw.runner_up_code as string | null) ?? null,
      third_place_code: (raw.third_place_code as string | null) ?? null,
      knockout_path:
        (raw.knockout_path as Array<{
          stage: 'r32' | 'r16' | 'qf' | 'sf' | 'final';
          match_id: string;
          pick_code: string | null;
        }>) ?? [],
      locked_at: (raw.locked_at as string | null) ?? null,
      payload: input.includePayload
        ? ((raw.payload as Record<string, unknown> | undefined) ?? undefined)
        : undefined,
    });
  },
};

export const getSyndicateTool: ToolDefinition<
  typeof GetSyndicateInput,
  typeof GetSyndicateOutput
> = {
  name: 'get_syndicate',
  tier: 'public',
  title: 'Get syndicate metadata',
  description:
    'Public syndicate metadata: display name, description, member count, created-at, and the canonical share URL at play.tournamental.com/s/<slug>. No PII is returned.',
  inputSchema: GetSyndicateInput,
  outputSchema: GetSyndicateOutput,
  async handler(input, ctx) {
    const raw = (await ctx.gameClient.getSyndicate(input.slug)) as Record<string, unknown>;
    return GetSyndicateOutput.parse({
      slug: input.slug,
      display_name: (raw.display_name as string) ?? input.slug,
      description: (raw.description as string | null) ?? null,
      member_count: (raw.member_count as number) ?? 0,
      created_at: (raw.created_at as string | null) ?? null,
      share_url:
        (raw.share_url as string | undefined) ??
        `https://play.tournamental.com/s/${input.slug}`,
    });
  },
};

export const getMatchPathTool: ToolDefinition<
  typeof GetMatchPathInput,
  typeof GetMatchPathOutput
> = {
  name: 'get_match_path',
  tier: 'public',
  title: 'Get a team\'s champion path',
  description:
    'Project the path a team would take to lift the trophy: group games, R32, R16, QF, SF, final - opponent codes and kickoff times included where known. Useful for bracket-builders.',
  inputSchema: GetMatchPathInput,
  outputSchema: GetMatchPathOutput,
  async handler(input, ctx) {
    const tournamentId = input.tournamentId ?? DEFAULT_TOURNAMENT_ID;
    const raw = (await ctx.gameClient.getMatchPath(input.teamCode, tournamentId)) as Record<
      string,
      unknown
    >;
    return GetMatchPathOutput.parse({
      team_code: input.teamCode,
      tournament_id: tournamentId,
      steps:
        (raw.steps as Array<{
          stage: 'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'final';
          match_id: string;
          opponent_code: string | null;
          kickoff_at: string | null;
        }>) ?? [],
      champion_path_complete: (raw.champion_path_complete as boolean) ?? false,
    });
  },
};

export const queryMoleculeTool: ToolDefinition<
  typeof QueryMoleculeInput,
  typeof QueryMoleculeOutput
> = {
  name: 'query_molecule',
  tier: 'public',
  title: 'Query bracket molecule (atoms + bonds)',
  description:
    'Returns all 48 atoms and the bond list for a bracket\'s 3D molecule representation. Useful for any agent that wants to reason about a bracket\'s shape without rendering it.',
  inputSchema: QueryMoleculeInput,
  outputSchema: QueryMoleculeOutput,
  async handler(input, ctx) {
    const raw = (await ctx.gameClient.queryMolecule(input.bracketGuid)) as Record<
      string,
      unknown
    >;
    const atoms =
      (raw.atoms as Array<{
        atom_id: string;
        stage: 'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'final';
        match_id: string;
        predicted_winner: string | null;
        predicted_score_home: number | null;
        predicted_score_away: number | null;
      }>) ?? [];
    const bonds =
      (raw.bonds as Array<{
        from_atom: string;
        to_atom: string;
        bond_type: 'advances' | 'feeds' | 'shares-pool';
      }>) ?? [];
    return QueryMoleculeOutput.parse({
      bracket_guid: input.bracketGuid,
      atom_count: atoms.length,
      atoms,
      bonds,
    });
  },
};

// ---------- User-scoped tools ----------

export const submitBracketTool: ToolDefinition<
  typeof SubmitBracketInput,
  typeof SubmitBracketOutput
> = {
  name: 'submit_bracket',
  tier: 'user',
  title: 'Submit a bracket',
  description:
    'Persist a bracket prediction for the calling user. Returns the bracket id, public share guid, and locked-at timestamp. Same contract as POST /v1/bracket/submit.',
  inputSchema: SubmitBracketInput,
  outputSchema: SubmitBracketOutput,
  async handler(input, ctx) {
    if (!ctx.userKey) throw new Error('user_key_required');
    const raw = (await ctx.gameClient.submitBracket(input.bracket, ctx.userKey)) as Record<
      string,
      unknown
    >;
    return SubmitBracketOutput.parse({
      bracket_id: (raw.bracket_id as string) ?? (raw.id as string),
      share_guid: (raw.share_guid as string) ?? '',
      locked_at: (raw.locked_at as string | null) ?? null,
      score_preview: (raw.score_preview as number | null) ?? null,
    });
  },
};

export const updatePickTool: ToolDefinition<typeof UpdatePickInput, typeof UpdatePickOutput> = {
  name: 'update_pick',
  tier: 'user',
  title: 'Update a single match pick',
  description:
    'Upsert a single match prediction. Outcome is one of home_win/away_win/draw. Server still enforces kickoff lockouts.',
  inputSchema: UpdatePickInput,
  outputSchema: UpdatePickOutput,
  async handler(input, ctx) {
    if (!ctx.userKey) throw new Error('user_key_required');
    const raw = (await ctx.gameClient.updatePick(
      input.matchId,
      input.outcome,
      input.scoreHome,
      input.scoreAway,
      ctx.userKey,
    )) as Record<string, unknown>;
    return UpdatePickOutput.parse({
      match_id: input.matchId,
      outcome: input.outcome,
      locked: (raw.locked as boolean) ?? false,
      locked_at: (raw.locked_at as string | null) ?? null,
    });
  },
};

export const lockPicksTool: ToolDefinition<typeof LockPicksInput, typeof LockPicksOutput> = {
  name: 'lock_picks',
  tier: 'user',
  title: 'Lock picks',
  description:
    'Mark the caller\'s picks locked. If untilMatchId is set, locks every pick up to and including that fixture; otherwise locks all open picks. Server enforces kickoff lockouts regardless.',
  inputSchema: LockPicksInput,
  outputSchema: LockPicksOutput,
  async handler(input, ctx) {
    if (!ctx.userKey) throw new Error('user_key_required');
    const raw = (await ctx.gameClient.lockPicks(input.untilMatchId, ctx.userKey)) as Record<
      string,
      unknown
    >;
    return LockPicksOutput.parse({
      locked_count: (raw.locked_count as number) ?? 0,
      locked_at: (raw.locked_at as string) ?? new Date().toISOString(),
    });
  },
};

export const saveShareGuidTool: ToolDefinition<
  typeof SaveShareGuidInput,
  typeof SaveShareGuidOutput
> = {
  name: 'save_share_guid',
  tier: 'user',
  title: 'Adopt a client-minted share guid',
  description:
    'Persist a share guid the client minted locally so the share URL becomes resolvable immediately. Idempotent.',
  inputSchema: SaveShareGuidInput,
  outputSchema: SaveShareGuidOutput,
  async handler(input, ctx) {
    if (!ctx.userKey) throw new Error('user_key_required');
    const raw = (await ctx.gameClient.saveShareGuid(input.shareGuid, ctx.userKey)) as Record<
      string,
      unknown
    >;
    return SaveShareGuidOutput.parse({
      share_guid: input.shareGuid,
      adopted: (raw.adopted as boolean) ?? true,
    });
  },
};

export const setHandleTool: ToolDefinition<typeof SetHandleInput, typeof SetHandleOutput> = {
  name: 'set_handle',
  tier: 'user',
  title: 'Set display handle',
  description:
    'Set the calling user\'s public display handle. Subject to profanity check and uniqueness. Returns accepted=false plus a rejection_reason if rejected.',
  inputSchema: SetHandleInput,
  outputSchema: SetHandleOutput,
  async handler(input, ctx) {
    if (!ctx.userKey) throw new Error('user_key_required');
    const raw = (await ctx.gameClient.setHandle(input.handle, ctx.userKey)) as Record<
      string,
      unknown
    >;
    return SetHandleOutput.parse({
      handle: input.handle,
      accepted: (raw.accepted as boolean) ?? true,
      rejection_reason:
        (raw.rejection_reason as 'profane' | 'taken' | 'too-short' | 'too-long' | null) ??
        null,
    });
  },
};

// ---------- Admin tools ----------

export const adminResolveMatchTool: ToolDefinition<
  typeof AdminResolveMatchInput,
  typeof AdminResolveMatchOutput
> = {
  name: 'admin_resolve_match',
  tier: 'admin',
  title: 'Resolve a match result (admin)',
  description:
    'Write the canonical match result. Triggers scoring recompute for every affected bracket. Admin only.',
  inputSchema: AdminResolveMatchInput,
  outputSchema: AdminResolveMatchOutput,
  async handler(input, ctx) {
    if (!ctx.adminKey) throw new Error('admin_key_required');
    const raw = (await ctx.gameClient.adminResolveMatch(
      input.matchId,
      input.outcome,
      input.scoreHome,
      input.scoreAway,
      ctx.adminKey,
    )) as Record<string, unknown>;
    return AdminResolveMatchOutput.parse({
      match_id: input.matchId,
      outcome: input.outcome,
      score_home: input.scoreHome,
      score_away: input.scoreAway,
      resolved_at: (raw.resolved_at as string) ?? new Date().toISOString(),
      affected_brackets: (raw.affected_brackets as number) ?? 0,
    });
  },
};

export const adminListPendingUsersTool: ToolDefinition<
  typeof AdminListPendingUsersInput,
  typeof AdminListPendingUsersOutput
> = {
  name: 'admin_list_pending_users',
  tier: 'admin',
  title: 'List pending users (admin moderation queue)',
  description:
    'Return users awaiting moderation: id, handle, created-at, and a flagged_reason string. Admin only.',
  inputSchema: AdminListPendingUsersInput,
  outputSchema: AdminListPendingUsersOutput,
  async handler(input, ctx) {
    if (!ctx.adminKey) throw new Error('admin_key_required');
    const raw = (await ctx.gameClient.adminListPendingUsers(
      input.limit,
      ctx.adminKey,
    )) as Record<string, unknown>;
    const rows =
      (raw.rows as Array<{
        user_id: string;
        handle: string | null;
        created_at: string;
        flagged_reason: string | null;
      }>) ?? [];
    return AdminListPendingUsersOutput.parse({
      rows,
      total: (raw.total as number) ?? rows.length,
    });
  },
};

export const adminInvalidateShareTool: ToolDefinition<
  typeof AdminInvalidateShareInput,
  typeof AdminInvalidateShareOutput
> = {
  name: 'admin_invalidate_share',
  tier: 'admin',
  title: 'Revoke a share link (admin)',
  description:
    'Revoke a public share guid so the share URL stops resolving. Used for moderation. Admin only.',
  inputSchema: AdminInvalidateShareInput,
  outputSchema: AdminInvalidateShareOutput,
  async handler(input, ctx) {
    if (!ctx.adminKey) throw new Error('admin_key_required');
    const raw = (await ctx.gameClient.adminInvalidateShare(
      input.guid,
      input.reason,
      ctx.adminKey,
    )) as Record<string, unknown>;
    return AdminInvalidateShareOutput.parse({
      guid: input.guid,
      revoked: (raw.revoked as boolean) ?? true,
      revoked_at: (raw.revoked_at as string) ?? new Date().toISOString(),
    });
  },
};

// ---------- Registry ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ALL_TOOLS: ToolDefinition<any, any>[] = [
  getTeamTool,
  getTournamentTool,
  getLeaderboardTool,
  getBracketByGuidTool,
  getSyndicateTool,
  getMatchPathTool,
  queryMoleculeTool,
  submitBracketTool,
  updatePickTool,
  lockPicksTool,
  saveShareGuidTool,
  setHandleTool,
  adminResolveMatchTool,
  adminListPendingUsersTool,
  adminInvalidateShareTool,
];

export interface PublicCatalogueEntry {
  readonly name: string;
  readonly tier: Tier;
  readonly title: string;
  readonly description: string;
  readonly input_schema: object;
  readonly output_schema: object;
}

export function publicCatalogue(): PublicCatalogueEntry[] {
  return ALL_TOOLS.map((t) => ({
    name: t.name,
    tier: t.tier,
    title: t.title,
    description: t.description,
    input_schema: zodToJsonSchema(t.inputSchema, { $refStrategy: 'none' }) as object,
    output_schema: zodToJsonSchema(t.outputSchema, { $refStrategy: 'none' }) as object,
  }));
}

export function toolByName(name: string): ToolDefinition<ZodTypeAny, ZodTypeAny> | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}
