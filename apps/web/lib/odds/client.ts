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
 * Wire shape returned by the live `apps/odds-ingest` service on
 * `GET /v1/odds/match/:matchNo`. It differs from this app's `MatchOdds`
 * (nested `{prob}` objects, `ts` epoch ms, no `homeWin`/`updatedAt`), so we
 * translate it here rather than leaking the upstream shape into the UI.
 */
interface IngestMatchResponse {
  match_no: number;
  kickoff: string | null;
  source: string | null;
  ts: number | null;
  home: { code: string; name: string; prob: number | null };
  draw: { prob: number | null } | null;
  away: { code: string; name: string; prob: number | null };
}

function isIngestMatchResponse(x: unknown): x is IngestMatchResponse {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const side = (v: unknown) =>
    !!v && typeof v === "object" && "prob" in (v as Record<string, unknown>);
  return side(o.home) && side(o.away) && "match_no" in o;
}

/** Map the odds-ingest source string onto this app's OddsSource union. */
function mapIngestSource(s: string | null | undefined): MatchOdds["source"] {
  return s === "polymarket" ? "polymarket" : "mock-fifa-rank";
}

/**
 * Wire shape returned by odds-ingest on the team winner/group endpoints:
 * `GET /v1/odds/team/:code/{winner,group}`. `prob` is null when no market
 * has been ingested yet.
 */
interface IngestTeamResponse {
  market_id: string;
  kind: string;
  team_name: string;
  source: string | null;
  ts?: number | null;
  prob: number | null;
  note?: string;
}

/**
 * Translate the odds-ingest `/v1/odds/match/:matchNo` payload into this
 * app's `MatchOdds`. Returns null when the upstream has no live probability
 * yet (so the caller falls through to the next tier rather than rendering
 * empty bars).
 */
function ingestMatchToMatchOdds(
  raw: IngestMatchResponse,
  matchNo: string,
  homeTeam: string,
  awayTeam: string,
): MatchOdds | null {
  const homeWin = raw.home?.prob;
  const awayWin = raw.away?.prob;
  if (typeof homeWin !== "number" || typeof awayWin !== "number") return null;
  const draw = raw.draw && typeof raw.draw.prob === "number" ? raw.draw.prob : null;
  return {
    matchNo,
    homeTeam: raw.home?.code || homeTeam,
    awayTeam: raw.away?.code || awayTeam,
    homeWin,
    draw,
    awayWin,
    source: mapIngestSource(raw.source),
    updatedAt: raw.ts ? new Date(raw.ts).toISOString() : new Date().toISOString(),
  };
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
        // Accept either this app's MatchOdds shape (from the Next.js stub
        // proxy) or the odds-ingest wire shape (nested {prob}, ts).
        if (isWellFormedMatchOdds(j)) {
          return { ok: true, data: j, tier: "live" };
        }
        if (isIngestMatchResponse(j)) {
          const mapped = ingestMatchToMatchOdds(j, matchNo, homeTeam, awayTeam);
          if (mapped) return { ok: true, data: mapped, tier: "live" };
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
        const raw = (await r.json()) as Partial<TeamWinnerSummary> & IngestTeamResponse;
        // Accept the app shape (from the Next.js stub proxy)…
        if (typeof raw.tournamentWinnerProb === "number") {
          return { ok: true, data: raw as TeamWinnerSummary, tier: "live" };
        }
        // …or the odds-ingest wire shape { prob, source, ts }.
        if (typeof raw.prob === "number") {
          return {
            ok: true,
            tier: "live",
            data: {
              teamCode,
              tournamentWinnerProb: raw.prob,
              groupWinnerProb: null,
              source: mapIngestSource(raw.source),
              updatedAt: raw.ts ? new Date(raw.ts).toISOString() : new Date().toISOString(),
            },
          };
        }
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
        const raw = (await r.json()) as Partial<TeamGroupSummary> & IngestTeamResponse;
        // Accept the app shape (from the Next.js stub proxy)…
        if (typeof raw.groupWinnerProb === "number") {
          return { ok: true, data: raw as TeamGroupSummary, tier: "live" };
        }
        // …or the odds-ingest wire shape { prob, source, ts }.
        if (typeof raw.prob === "number") {
          return {
            ok: true,
            tier: "live",
            data: {
              teamCode,
              groupId,
              groupWinnerProb: raw.prob,
              source: mapIngestSource(raw.source),
              updatedAt: raw.ts ? new Date(raw.ts).toISOString() : new Date().toISOString(),
            },
          };
        }
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
