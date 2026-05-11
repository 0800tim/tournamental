/**
 * Contract tests for the 7 public read tools. Each test stubs the
 * upstream game-service via an in-process fake `fetch` and verifies:
 *
 *   1. dispatch result status === 'ok'
 *   2. the returned value passes the tool's Zod output schema
 *   3. the upstream HTTP path the client called
 */

import { describe, expect, it } from 'vitest';

import {
  GetBracketByGuidOutput,
  GetLeaderboardOutput,
  GetMatchPathOutput,
  GetSyndicateOutput,
  GetTeamOutput,
  GetTournamentOutput,
  QueryMoleculeOutput,
} from '../src/lib/schemas.js';

import { FakeFetcher, callTool, makeFakeContext } from './test-helpers.js';

describe('public read tools', () => {
  it('get_team: returns validated team metadata', async () => {
    const fetcher = new FakeFetcher().on({
      method: 'GET',
      pathPattern: /^\/v1\/team\/ARG$/,
      body: {
        name: 'Argentina',
        fifa_rank: 1,
        flag_emoji: '🇦🇷',
        confederation: 'CONMEBOL',
        kit: {
          home_primary: '#75AADB',
          home_secondary: '#FFFFFF',
          away_primary: '#1A2A6C',
          away_secondary: '#FFFFFF',
        },
      },
    });

    const r = await callTool('get_team', { teamCode: 'ARG' }, makeFakeContext({ fetcher }));
    expect(r.status).toBe('ok');
    const parsed = GetTeamOutput.parse(r.result);
    expect(parsed.name).toBe('Argentina');
    expect(parsed.fifa_rank).toBe(1);
    expect(parsed.kit?.home_primary).toBe('#75AADB');
  });

  it('get_team: validates team code shape', async () => {
    const r = await callTool('get_team', { teamCode: 'argentina' }, makeFakeContext());
    expect(r.status).toBe('validation_error');
    expect(r.httpCode).toBe(400);
  });

  it('get_tournament: returns WC2026 state by default', async () => {
    const fetcher = new FakeFetcher().on({
      method: 'GET',
      pathPattern: /^\/v1\/tournament\/fifa-wc-2026$/,
      body: {
        name: 'FIFA World Cup 2026',
        status: 'preview',
        starts_at: '2026-06-11T20:00:00Z',
        ends_at: '2026-07-19T20:00:00Z',
        groups: [
          { group_id: 'A', teams: ['MEX', 'USA', 'CAN', 'JAM'] },
          { group_id: 'B', teams: ['ARG', 'CHL', 'URU', 'PER'] },
        ],
        fixture_count: 104,
        knockout_locked: false,
      },
    });

    const r = await callTool('get_tournament', {}, makeFakeContext({ fetcher }));
    expect(r.status).toBe('ok');
    const parsed = GetTournamentOutput.parse(r.result);
    expect(parsed.tournament_id).toBe('fifa-wc-2026');
    expect(parsed.groups.length).toBe(2);
    expect(parsed.fixture_count).toBe(104);
  });

  it('get_leaderboard: global scope, preview flag honoured', async () => {
    const fetcher = new FakeFetcher().on({
      method: 'GET',
      pathPattern: /^\/v1\/leaderboard\/fifa-wc-2026$/,
      body: {
        preview: true,
        rows: [
          {
            rank: 1,
            user_handle: 'messi-fan',
            score_total: 0,
            bracket_share_guid: 'abc123def456',
          },
          { rank: 2, user_handle: 'mbappe', score_total: 0, bracket_share_guid: null },
        ],
        total: 2,
      },
    });

    const r = await callTool(
      'get_leaderboard',
      { tournamentId: 'fifa-wc-2026', scope: 'global', limit: 10, offset: 0 },
      makeFakeContext({ fetcher }),
    );
    expect(r.status).toBe('ok');
    const parsed = GetLeaderboardOutput.parse(r.result);
    expect(parsed.preview).toBe(true);
    expect(parsed.rows[0]!.user_handle).toBe('messi-fan');
  });

  it('get_leaderboard: requires syndicateSlug when scope=syndicate', async () => {
    const r = await callTool(
      'get_leaderboard',
      { tournamentId: 'fifa-wc-2026', scope: 'syndicate', limit: 10, offset: 0 },
      makeFakeContext(),
    );
    expect(r.status).toBe('validation_error');
  });

  it('get_bracket_by_guid: returns champion + path', async () => {
    const fetcher = new FakeFetcher().on({
      method: 'GET',
      pathPattern: /^\/v1\/bracket\/by-guid\/abcdef0123456789$/,
      body: {
        share_guid: 'abcdef0123456789',
        user_handle: 'tim',
        tournament_id: 'fifa-wc-2026',
        champion_code: 'ARG',
        runner_up_code: 'FRA',
        third_place_code: 'BRA',
        knockout_path: [{ stage: 'final', match_id: 'final', pick_code: 'ARG' }],
        locked_at: '2026-06-10T00:00:00Z',
      },
    });

    const r = await callTool(
      'get_bracket_by_guid',
      { guid: 'abcdef0123456789', includePayload: false },
      makeFakeContext({ fetcher }),
    );
    expect(r.status).toBe('ok');
    const parsed = GetBracketByGuidOutput.parse(r.result);
    expect(parsed.champion_code).toBe('ARG');
    expect(parsed.knockout_path.length).toBe(1);
    expect(parsed.payload).toBeUndefined();
  });

  it('get_bracket_by_guid: includes payload when requested', async () => {
    const fetcher = new FakeFetcher().on({
      method: 'GET',
      pathPattern: /^\/v1\/bracket\/by-guid\/abcdef0123456789$/,
      queryAllowList: { include: 'payload' },
      body: {
        share_guid: 'abcdef0123456789',
        user_handle: null,
        tournament_id: 'fifa-wc-2026',
        champion_code: 'ARG',
        runner_up_code: null,
        third_place_code: null,
        knockout_path: [],
        locked_at: null,
        payload: {
          groupPredictions: {},
          knockoutPredictions: { final: { matchId: 'final' } },
        },
      },
    });

    const r = await callTool(
      'get_bracket_by_guid',
      { guid: 'abcdef0123456789', includePayload: true },
      makeFakeContext({ fetcher }),
    );
    expect(r.status).toBe('ok');
    const parsed = GetBracketByGuidOutput.parse(r.result);
    expect(parsed.payload).toBeDefined();
    expect(parsed.payload?.knockoutPredictions).toBeDefined();
  });

  it('get_syndicate: returns metadata + canonical share URL', async () => {
    const fetcher = new FakeFetcher().on({
      method: 'GET',
      pathPattern: /^\/v1\/syndicate\/coffeebean-crew$/,
      body: {
        display_name: 'CoffeeBean Crew',
        description: 'For the office bracket.',
        member_count: 12,
        created_at: '2026-05-01T00:00:00Z',
      },
    });

    const r = await callTool(
      'get_syndicate',
      { slug: 'coffeebean-crew' },
      makeFakeContext({ fetcher }),
    );
    expect(r.status).toBe('ok');
    const parsed = GetSyndicateOutput.parse(r.result);
    expect(parsed.display_name).toBe('CoffeeBean Crew');
    expect(parsed.member_count).toBe(12);
    expect(parsed.share_url).toBe('https://play.tournamental.com/s/coffeebean-crew');
  });

  it('get_match_path: returns champion-path projection', async () => {
    const fetcher = new FakeFetcher().on({
      method: 'GET',
      pathPattern: /^\/v1\/tournament\/fifa-wc-2026\/team\/ARG\/path$/,
      body: {
        steps: [
          { stage: 'group', match_id: 'g_arg_01', opponent_code: 'KSA', kickoff_at: null },
          { stage: 'r32', match_id: 'r32_01', opponent_code: 'AUS', kickoff_at: null },
          { stage: 'final', match_id: 'final', opponent_code: 'FRA', kickoff_at: null },
        ],
        champion_path_complete: true,
      },
    });

    const r = await callTool(
      'get_match_path',
      { teamCode: 'ARG' },
      makeFakeContext({ fetcher }),
    );
    expect(r.status).toBe('ok');
    const parsed = GetMatchPathOutput.parse(r.result);
    expect(parsed.champion_path_complete).toBe(true);
    expect(parsed.steps.length).toBe(3);
  });

  it('query_molecule: returns atoms + bonds', async () => {
    const fetcher = new FakeFetcher().on({
      method: 'GET',
      pathPattern: /^\/v1\/molecule\/abcdef0123456789$/,
      body: {
        atoms: [
          {
            atom_id: 'final',
            stage: 'final',
            match_id: 'final',
            predicted_winner: 'ARG',
            predicted_score_home: 3,
            predicted_score_away: 1,
          },
        ],
        bonds: [{ from_atom: 'sf_01', to_atom: 'final', bond_type: 'advances' }],
      },
    });

    const r = await callTool(
      'query_molecule',
      { bracketGuid: 'abcdef0123456789' },
      makeFakeContext({ fetcher }),
    );
    expect(r.status).toBe('ok');
    const parsed = QueryMoleculeOutput.parse(r.result);
    expect(parsed.atoms.length).toBe(1);
    expect(parsed.bonds.length).toBe(1);
    expect(parsed.atom_count).toBe(1);
  });
});

describe('catalogue', () => {
  it('publishes 15 tools with three tiers', async () => {
    const { ALL_TOOLS, publicCatalogue } = await import('../src/tools/catalogue.js');
    expect(ALL_TOOLS.length).toBe(15);
    const tiers = new Set(ALL_TOOLS.map((t) => t.tier));
    expect(tiers.has('public')).toBe(true);
    expect(tiers.has('user')).toBe(true);
    expect(tiers.has('admin')).toBe(true);
    const cat = publicCatalogue();
    expect(cat.length).toBe(15);
    for (const entry of cat) {
      expect(entry.name).toBeTruthy();
      expect(entry.input_schema).toBeTruthy();
      expect(entry.output_schema).toBeTruthy();
    }
  });
});

describe('auth gating', () => {
  it('user-tier tool refuses without a user key', async () => {
    const r = await callTool(
      'submit_bracket',
      { bracket: { tournamentId: 'fifa-wc-2026' } },
      makeFakeContext(),
    );
    expect(r.status).toBe('auth_failed');
    expect(r.httpCode).toBe(401);
  });

  it('admin-tier tool refuses without an admin key', async () => {
    const r = await callTool(
      'admin_resolve_match',
      { matchId: 'final', outcome: 'home_win', scoreHome: 3, scoreAway: 1 },
      makeFakeContext(),
    );
    expect(r.status).toBe('auth_failed');
    expect(r.httpCode).toBe(401);
  });

  it('admin-tier tool refuses non-allowlisted IP on HTTP', async () => {
    const r = await callTool(
      'admin_resolve_match',
      { matchId: 'final', outcome: 'home_win', scoreHome: 3, scoreAway: 1 },
      makeFakeContext({
        adminKey: 'admin-key-test-abcdefghijklmnop',
        ip: '8.8.8.8',
        adminIps: new Set(['10.0.0.1']),
      }),
    );
    expect(r.status).toBe('auth_failed');
    expect(r.httpCode).toBe(403);
  });
});

describe('rate limiting', () => {
  it('public tier blocks at 60 calls/min', async () => {
    const fetcher = new FakeFetcher().on({
      method: 'GET',
      pathPattern: /^\/v1\/team\/ARG$/,
      body: {
        name: 'Argentina',
        fifa_rank: 1,
        flag_emoji: '🇦🇷',
        confederation: 'CONMEBOL',
        kit: null,
      },
    });
    const ctx = makeFakeContext({ fetcher });
    let allowed = 0;
    let blocked = 0;
    for (let i = 0; i < 70; i += 1) {
      const r = await callTool('get_team', { teamCode: 'ARG' }, ctx);
      if (r.status === 'ok') allowed += 1;
      else if (r.status === 'rate_limited') blocked += 1;
    }
    expect(allowed).toBe(60);
    expect(blocked).toBe(10);
  });
});

describe('audit', () => {
  it('redacts userKey and adminKey in audit entries', async () => {
    const { redact } = await import('../src/lib/audit.js');
    const out = redact({
      userKey: 'super-secret-value-1234',
      bracket: { tournamentId: 'fifa-wc-2026' },
    }) as Record<string, unknown>;
    expect(typeof out.userKey).toBe('string');
    expect((out.userKey as string).includes('***')).toBe(true);
    expect((out.userKey as string).includes('secret')).toBe(false);
  });
});
