/**
 * Tiered odds client.
 *
 * Tier 1, `process.env.NEXT_PUBLIC_ODDS_API_URL` (the real
 *   `apps/odds-ingest` service). Built by a parallel agent. May not be
 *   live when the chip is wired in, so we tolerate failure quietly.
 *
 * Tier 2, `/api/odds/*` Next.js route handlers in this app. They proxy
 *   to upstream when configured; without configuration they call the
 *   mock generator. Useful for local dev and for unit-testing the API
 *   contract without a network call.
 *
 * Tier 3, `mockMatchOdds` directly, with world ranks looked up from
 *   `data/fifa-wc-2026/teams.json`. The chip never renders empty.
 *
 * The same client serves the browser (via `fetch`) and Next.js route
 * handlers (where we want to skip Tier 2 to avoid recursion). The
 * `tier` field on the result tells the caller where the data came from
 * so the hover-card can attribute it correctly.
 */

import canonicalTeamsRaw from "@/../../data/fifa-wc-2026/teams.json";

import { mockMatchOdds, mockOddsForUnknownTeams, mockOddsHistory } from "./mock";
import type {
  MatchOdds,
  OddsClientResult,
  OddsHistory,
  TeamGroupSummary,
  TeamWinnerSummary,
} from "./types";

interface CanonicalTeam {
  readonly code: string;
  readonly name: string;
  readonly fifa_ranking_at_2026?: number;
}
interface CanonicalTeamsFile {
  readonly teams: readonly CanonicalTeam[];
}

const TEAMS_BY_CODE: ReadonlyMap<string, CanonicalTeam> = new Map(
  (canonicalTeamsRaw as CanonicalTeamsFile).teams.map((t) => [t.code, t]),
);

/** Look up a world rank with a sensible default for unknowns. */
export function fifaRank(code: string): number {
  const t = TEAMS_BY_CODE.get(code);
  if (t && typeof t.fifa_ranking_at_2026 === "number") {
    return t.fifa_ranking_at_2026;
  }
  return 50;
}

export interface FetchMatchOddsArgs {
  readonly matchNo: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
  /** Knockout matches have no draw outcome. */
  readonly noDraw?: boolean;
  /** Skip the Next.js stub (use when calling from inside the stub itself). */
  readonly skipStub?: boolean;
  /** Override fetch impl (used in tests). */
  readonly fetchImpl?: typeof fetch;
  /** Tier-1 base URL override. Defaults to NEXT_PUBLIC_ODDS_API_URL. */
  readonly upstreamBaseUrl?: string | null;
  /** AbortSignal, pass through to fetch. */
  readonly signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 4000;

function resolveUpstream(override: string | null | undefined): string | null {
  if (override !== undefined) return override;
  if (typeof process !== "undefined" && process.env && process.env.NEXT_PUBLIC_ODDS_API_URL) {
    return process.env.NEXT_PUBLIC_ODDS_API_URL;
  }
  // No env config and no explicit override: skip Tier 1 silently.
  return null;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  signal: AbortSignal | undefined,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    return await fetchImpl(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
  } finally {
    clearTimeout(t);
  }
}

function isWellFormedMatchOdds(x: unknown): x is MatchOdds {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.matchNo === "string" &&
    typeof o.homeTeam === "string" &&
    typeof o.awayTeam === "string" &&
    typeof o.homeWin === "number" &&
    (o.draw === null || typeof o.draw === "number") &&
    typeof o.awayWin === "number" &&
    typeof o.source === "string" &&
    typeof o.updatedAt === "string"
  );
}

/**
 * Fetch odds for a single match. Walks the three-tier fallback ladder
 * and returns the first successful response. Throws nothing, every
 * path resolves to a stable result the UI can render.
 */
export async function fetchMatchOdds(
  args: FetchMatchOddsArgs,
): Promise<OddsClientResult<MatchOdds>> {
  const { matchNo, homeTeam, awayTeam, noDraw, skipStub, signal } = args;
  const fetchImpl = args.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);

  // Tier 1: upstream odds-ingest API.
  const upstream = resolveUpstream(args.upstreamBaseUrl);
  if (upstream && fetchImpl) {
    try {
      const url = `${upstream.replace(/\/$/, "")}/v1/odds/match/${encodeURIComponent(matchNo)}`;
      const r = await fetchWithTimeout(fetchImpl, url, signal);
      if (r.ok) {
        const j = (await r.json()) as unknown;
        if (isWellFormedMatchOdds(j)) {
          return { ok: true, data: j, tier: "live" };
        }
      }
    } catch {
      // Network/abort/parse failures fall through to Tier 2.
    }
  }

  // Tier 2: local Next.js stub at /api/odds/match/[matchNo].
  if (!skipStub && fetchImpl && typeof window !== "undefined") {
    try {
      const url = `/api/odds/match/${encodeURIComponent(matchNo)}`;
      const r = await fetchWithTimeout(fetchImpl, url, signal);
      if (r.ok) {
        const j = (await r.json()) as unknown;
        if (isWellFormedMatchOdds(j)) {
          return { ok: true, data: j, tier: "stub" };
        }
      }
    } catch {
      // Fall through.
    }
  }

  // Tier 3: deterministic mock.
  const data = generateMockOdds(matchNo, homeTeam, awayTeam, noDraw);
  return { ok: true, data, tier: "mock" };
}

/** Direct mock-data path, exposed so the route stubs can call it. */
export function generateMockOdds(
  matchNo: string,
  homeTeam: string,
  awayTeam: string,
  noDraw?: boolean,
): MatchOdds {
  if (!homeTeam || !awayTeam) {
    return mockOddsForUnknownTeams(matchNo, noDraw);
  }
  return mockMatchOdds({
    matchNo,
    homeTeam,
    awayTeam,
    homeRank: fifaRank(homeTeam),
    awayRank: fifaRank(awayTeam),
    noDraw,
  });
}

/** Mock history fallthrough used by `/api/odds/match/[matchNo]/history`. */
export function generateMockHistory(matchNo: string, current: MatchOdds): OddsHistory {
  return {
    matchNo,
    bucket: "1d",
    points: mockOddsHistory(matchNo, current, 14).points,
  };
}

export interface FetchTeamWinnerArgs {
  readonly teamCode: string;
  readonly fetchImpl?: typeof fetch;
  readonly upstreamBaseUrl?: string | null;
  readonly skipStub?: boolean;
  readonly signal?: AbortSignal;
}

export async function fetchTeamWinnerSummary(
  args: FetchTeamWinnerArgs,
): Promise<OddsClientResult<TeamWinnerSummary>> {
  const { teamCode, skipStub, signal } = args;
  const fetchImpl = args.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  const upstream = resolveUpstream(args.upstreamBaseUrl);

  if (upstream && fetchImpl) {
    try {
      const r = await fetchWithTimeout(
        fetchImpl,
        `${upstream.replace(/\/$/, "")}/v1/odds/team/${encodeURIComponent(teamCode)}/winner`,
        signal,
      );
      if (r.ok) {
        const j = (await r.json()) as TeamWinnerSummary;
        return { ok: true, data: j, tier: "live" };
      }
    } catch { /* fall through */ }
  }

  if (!skipStub && fetchImpl && typeof window !== "undefined") {
    try {
      const r = await fetchWithTimeout(
        fetchImpl,
        `/api/odds/team/${encodeURIComponent(teamCode)}/winner`,
        signal,
      );
      if (r.ok) {
        const j = (await r.json()) as TeamWinnerSummary;
        return { ok: true, data: j, tier: "stub" };
      }
    } catch { /* fall through */ }
  }

  // Mock: derive from world rank, top-3 ~ 12-22%, top-10 ~ 4-8%, rest <2%.
  const rank = fifaRank(teamCode);
  const tournamentWinnerProb = rank <= 1 ? 0.22
    : rank <= 3 ? 0.16 - (rank - 1) * 0.03
    : rank <= 10 ? 0.08 - (rank - 3) * 0.008
    : Math.max(0.005, 0.04 - rank * 0.0005);
  return {
    ok: true,
    tier: "mock",
    data: {
      teamCode,
      tournamentWinnerProb: Math.round(tournamentWinnerProb * 1000) / 1000,
      groupWinnerProb: null,
      source: "mock-fifa-rank",
      updatedAt: new Date().toISOString(),
    },
  };
}

export interface FetchTeamGroupArgs {
  readonly teamCode: string;
  readonly groupId: string;
  /** Other team codes in the same group, used by the mock to normalise. */
  readonly groupTeamCodes: readonly string[];
  readonly fetchImpl?: typeof fetch;
  readonly upstreamBaseUrl?: string | null;
  readonly skipStub?: boolean;
  readonly signal?: AbortSignal;
}

export async function fetchTeamGroupSummary(
  args: FetchTeamGroupArgs,
): Promise<OddsClientResult<TeamGroupSummary>> {
  const { teamCode, groupId, groupTeamCodes, skipStub, signal } = args;
  const fetchImpl = args.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  const upstream = resolveUpstream(args.upstreamBaseUrl);

  if (upstream && fetchImpl) {
    try {
      const r = await fetchWithTimeout(
        fetchImpl,
        `${upstream.replace(/\/$/, "")}/v1/odds/team/${encodeURIComponent(teamCode)}/group`,
        signal,
      );
      if (r.ok) {
        const j = (await r.json()) as TeamGroupSummary;
        return { ok: true, data: j, tier: "live" };
      }
    } catch { /* fall through */ }
  }

  if (!skipStub && fetchImpl && typeof window !== "undefined") {
    try {
      const r = await fetchWithTimeout(
        fetchImpl,
        `/api/odds/team/${encodeURIComponent(teamCode)}/group?group=${encodeURIComponent(groupId)}`,
        signal,
      );
      if (r.ok) {
        const j = (await r.json()) as TeamGroupSummary;
        return { ok: true, data: j, tier: "stub" };
      }
    } catch { /* fall through */ }
  }

  // Mock: invert world-rank within the group, normalise to 1.0.
  const teamRank = fifaRank(teamCode);
  const allRanks = groupTeamCodes.map((c) => fifaRank(c));
  // Lower rank = stronger; convert to weight via 1 / sqrt(rank).
  const weights = allRanks.map((r) => 1 / Math.sqrt(Math.max(1, r)));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const teamWeight = 1 / Math.sqrt(Math.max(1, teamRank));
  const groupWinnerProb = totalWeight === 0 ? 0.25 : teamWeight / totalWeight;

  return {
    ok: true,
    tier: "mock",
    data: {
      teamCode,
      groupId,
      groupWinnerProb: Math.round(groupWinnerProb * 1000) / 1000,
      source: "mock-fifa-rank",
      updatedAt: new Date().toISOString(),
    },
  };
}
