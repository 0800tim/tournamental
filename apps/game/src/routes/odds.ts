/**
 * Polymarket-derived odds read endpoints.
 *
 *   GET /v1/odds/match/:match_id     , latest match-moneyline implied probs
 *   GET /v1/odds/winner-market       , latest tournament-winner implied probs
 *   GET /v1/odds/snapshot            , combined payload used by /run page load
 *
 * Data source: the odds-ingest service writes a SQLite file at
 * `apps/odds-ingest/data/odds-ingest.sqlite`. This route opens that file
 * READ-ONLY (it is owned by the ingest service, never the game-service)
 * and serves the latest tick per (market, outcome).
 *
 * Match-id mapping:
 *   The browser-swarm constructs `match_id` as the raw integer string
 *   1..72 (one per group fixture in canonical fixture order , see
 *   apps/web/components/browser-swarm/regenerate.ts:205). The odds DB
 *   stores markets with id `wc2026:match:N` and `match_id="N"`. To make
 *   the API forgiving for callers we accept either form:
 *     - integer string         "1", "12", "72"
 *     - canonical 3-digit form "wc2026-m001", "wc2026-m072"
 *   Both resolve to the same row.
 *
 * Caching (per docs/22):
 *   Cache-Control: public, s-maxage=60, stale-while-revalidate=300
 *   SQLite reads are microseconds; the edge cache absorbs spikes.
 *
 * Spec: docs/superpowers/specs/2026-06-08-polymarket-odds-endpoint.md
 */

import { existsSync } from "node:fs";

import Database from "better-sqlite3";
import type { Database as DatabaseT } from "better-sqlite3";
import type { FastifyInstance } from "fastify";

const PUBLIC_CACHE_HEADER = "public, s-maxage=60, stale-while-revalidate=300";

const DEFAULT_DB_PATH =
  "/home/clawdbot/clawdia/projects/vtorn/apps/odds-ingest/data/odds-ingest.sqlite";

interface OutcomeMeta {
  readonly label: string;
  readonly our_team_code: string | null;
}

interface MarketRow {
  readonly id: string;
  readonly match_id: string | null;
  readonly outcomes_json: string;
  readonly updated_at: number;
}

interface LatestTickRow {
  readonly outcome_label: string;
  readonly last: number | null;
  readonly implied_prob: number | null;
  readonly ts: number;
}

interface WinnerLatestRow {
  readonly market_id: string;
  readonly last: number | null;
  readonly implied_prob: number | null;
  readonly ts: number;
}

/**
 * Singleton read-only DB handle for the odds-ingest file. The
 * game-service is a long-lived process; opening once amortises the
 * cost across thousands of requests. We re-open lazily on first
 * access so tests / unit boots that don't touch odds don't pay for it.
 */
let odbCache: DatabaseT | null = null;
let odbPath: string | null = null;

function openOddsDb(path: string): DatabaseT | null {
  if (odbCache && odbPath === path) return odbCache;
  if (odbCache) {
    try {
      odbCache.close();
    } catch {
      // ignore
    }
    odbCache = null;
  }
  if (!existsSync(path)) return null;
  // readonly + fileMustExist guards against the route writing back
  // to the ingest file by accident. Concurrent writers (the ingest
  // process) write through WAL; SQLite handles read snapshots safely.
  odbCache = new Database(path, { readonly: true, fileMustExist: true });
  odbCache.pragma("journal_mode = WAL");
  odbCache.pragma("query_only = ON");
  odbPath = path;
  return odbCache;
}

/**
 * Test / reload helper. Closes any open handle so the next request
 * re-opens against the configured path. Exported so unit tests can
 * point at a fresh fixture DB without leaking the previous one.
 */
export function _closeOddsDb(): void {
  if (odbCache) {
    try {
      odbCache.close();
    } catch {
      // ignore
    }
  }
  odbCache = null;
  odbPath = null;
}

/**
 * Normalise an inbound match-id to the integer form 1..72 used by the
 * odds DB. Returns null if the value is not a recognised form.
 *
 * Accepted:
 *   "1", "12", "72"            -> 1, 12, 72
 *   "wc2026-m001", "wc2026-m072" -> 1, 72
 *
 * Knockout fixtures (id like `r32-1`, `qf-1`) are not in scope for v0.1;
 * Polymarket only carries group-stage moneylines at this point.
 */
function normaliseMatchId(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const canonical = trimmed.match(/^wc2026-m0*(\d+)$/i);
  if (canonical) {
    const n = Number.parseInt(canonical[1] ?? "", 10);
    if (Number.isFinite(n) && n >= 1 && n <= 200) return n;
    return null;
  }
  if (/^\d+$/.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 200) return n;
  }
  return null;
}

/** 3-digit zero-padded canonical form, e.g. `wc2026-m001`. */
function canonicalMatchKey(n: number): string {
  return `wc2026-m${String(n).padStart(3, "0")}`;
}

function parseOutcomes(json: string): readonly OutcomeMeta[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((o): o is Record<string, unknown> => typeof o === "object" && o !== null)
      .map((o) => ({
        label: typeof o.label === "string" ? o.label : "",
        our_team_code:
          typeof o.our_team_code === "string" && o.our_team_code.length > 0
            ? o.our_team_code
            : null,
      }))
      .filter((o) => o.label.length > 0);
  } catch {
    return [];
  }
}

interface MatchProbs {
  readonly home_team: string | null;
  readonly away_team: string | null;
  readonly home_win: number | null;
  readonly draw: number | null;
  readonly away_win: number | null;
  readonly updated_at: number;
}

/**
 * Pull the latest tick per outcome for a market and fold it into the
 * shape expected by the browser-swarm odds substitution path.
 *
 * outcomes_json ordering convention (verified for the WC26 group-stage
 * markets): [home_team, "Draw", away_team]. The mapping is anchored on
 * `our_team_code != null` to spot the team rows, with the remaining row
 * folded into "draw".
 */
function loadMatchProbs(db: DatabaseT, marketId: string): MatchProbs | null {
  const market = db
    .prepare<[string], MarketRow>(
      `SELECT id, match_id, outcomes_json, updated_at
         FROM odds_market
        WHERE id = ?`,
    )
    .get(marketId);
  if (!market) return null;
  const outcomes = parseOutcomes(market.outcomes_json);
  if (outcomes.length < 2) return null;

  const ticks = db
    .prepare<[string], LatestTickRow>(
      `SELECT outcome_label, last, implied_prob, ts
         FROM odds_tick
        WHERE market_id = ?
          AND ts = (
            SELECT MAX(ts) FROM odds_tick AS t2
             WHERE t2.market_id = odds_tick.market_id
               AND t2.outcome_label = odds_tick.outcome_label
          )`,
    )
    .all(marketId);
  if (ticks.length === 0) return null;
  const byLabel = new Map<string, LatestTickRow>();
  for (const t of ticks) byLabel.set(t.outcome_label, t);

  let homeTeam: string | null = null;
  let awayTeam: string | null = null;
  let homeLabel: string | null = null;
  let drawLabel: string | null = null;
  let awayLabel: string | null = null;

  // First pass: identify the two team labels by their position relative
  // to the "Draw" entry. The outcomes_json order is [home, draw, away]
  // for every WC26 group fixture, so the first our_team_code-bearing
  // outcome is home, the second is away.
  const teamSlots = outcomes.filter((o) => o.our_team_code !== null);
  if (teamSlots.length >= 2) {
    homeTeam = teamSlots[0]?.our_team_code ?? null;
    awayTeam = teamSlots[1]?.our_team_code ?? null;
    homeLabel = teamSlots[0]?.label ?? null;
    awayLabel = teamSlots[1]?.label ?? null;
  } else {
    // Fall back to first / last when team codes are missing (mock seeds).
    homeLabel = outcomes[0]?.label ?? null;
    awayLabel = outcomes[outcomes.length - 1]?.label ?? null;
  }
  for (const o of outcomes) {
    if (o.our_team_code === null && o.label.toLowerCase() === "draw") {
      drawLabel = o.label;
      break;
    }
  }
  if (!drawLabel) {
    // No explicit Draw outcome means this isn't a moneyline; treat as
    // unusable rather than fudging numbers.
    return null;
  }

  const home = homeLabel ? byLabel.get(homeLabel) ?? null : null;
  const draw = drawLabel ? byLabel.get(drawLabel) ?? null : null;
  const away = awayLabel ? byLabel.get(awayLabel) ?? null : null;

  const pick = (row: LatestTickRow | null): number | null => {
    if (!row) return null;
    if (row.last !== null && Number.isFinite(row.last)) return row.last;
    if (row.implied_prob !== null && Number.isFinite(row.implied_prob))
      return row.implied_prob;
    return null;
  };

  const updatedAt = Math.max(
    market.updated_at ?? 0,
    home?.ts ?? 0,
    draw?.ts ?? 0,
    away?.ts ?? 0,
  );

  return {
    home_team: homeTeam,
    away_team: awayTeam,
    home_win: pick(home),
    draw: pick(draw),
    away_win: pick(away),
    updated_at: updatedAt,
  };
}

interface WinnerEntry {
  readonly team_code: string;
  readonly implied_prob: number;
  readonly updated_at: number;
}

function loadWinnerMarket(db: DatabaseT): readonly WinnerEntry[] {
  const rows = db
    .prepare<[], WinnerLatestRow>(
      `SELECT market_id, last, implied_prob, ts
         FROM odds_tick AS ot
        WHERE outcome_label = 'Yes'
          AND market_id LIKE 'wc2026:winner:%'
          AND ts = (
            SELECT MAX(ts) FROM odds_tick AS t2
             WHERE t2.market_id = ot.market_id
               AND t2.outcome_label = 'Yes'
          )`,
    )
    .all();
  const out: WinnerEntry[] = [];
  for (const r of rows) {
    const prob =
      r.last !== null && Number.isFinite(r.last)
        ? r.last
        : r.implied_prob !== null && Number.isFinite(r.implied_prob)
          ? r.implied_prob
          : null;
    if (prob === null) continue;
    const match = r.market_id.match(/^wc2026:winner:([A-Z]{2,4})$/);
    if (!match) continue;
    out.push({
      team_code: match[1] ?? "",
      implied_prob: prob,
      updated_at: r.ts,
    });
  }
  out.sort((a, b) => b.implied_prob - a.implied_prob);
  return out;
}

export interface OddsRoutesDeps {
  /** Override the SQLite path. Falls back to env / built-in default. */
  readonly dbPath?: string;
}

export async function registerOddsRoutes(
  app: FastifyInstance,
  deps: OddsRoutesDeps = {},
): Promise<void> {
  const dbPath =
    deps.dbPath ?? process.env.ODDS_INGEST_DB_PATH ?? DEFAULT_DB_PATH;

  function db(): DatabaseT | null {
    return openOddsDb(dbPath);
  }

  app.get("/v1/odds/match/:match_id", async (req, reply) => {
    const params = req.params as { match_id?: string };
    const raw = (params.match_id ?? "").trim();
    if (!raw) {
      return reply.code(400).send({ error: "invalid_match_id" });
    }
    const n = normaliseMatchId(raw);
    if (n === null) {
      return reply.code(400).send({ error: "invalid_match_id" });
    }
    const handle = db();
    if (!handle) {
      reply.header("Cache-Control", PUBLIC_CACHE_HEADER);
      return reply.code(404).send({ error: "no_market" });
    }
    const probs = loadMatchProbs(handle, `wc2026:match:${n}`);
    if (!probs) {
      reply.header("Cache-Control", PUBLIC_CACHE_HEADER);
      return reply.code(404).send({ error: "no_market" });
    }
    reply.header("Cache-Control", PUBLIC_CACHE_HEADER);
    return {
      match_id: String(n),
      home_team: probs.home_team,
      away_team: probs.away_team,
      home_win: probs.home_win,
      draw: probs.draw,
      away_win: probs.away_win,
      source: "polymarket",
      updated_at: probs.updated_at,
    };
  });

  app.get("/v1/odds/winner-market", async (_req, reply) => {
    const handle = db();
    reply.header("Cache-Control", PUBLIC_CACHE_HEADER);
    if (!handle) {
      return { teams: [], source: "polymarket" };
    }
    const entries = loadWinnerMarket(handle);
    return {
      teams: entries.map((e) => ({
        team_code: e.team_code,
        implied_prob: e.implied_prob,
        updated_at: e.updated_at,
      })),
      source: "polymarket",
    };
  });

  app.get("/v1/odds/snapshot", async (_req, reply) => {
    reply.header("Cache-Control", PUBLIC_CACHE_HEADER);
    const handle = db();
    const generatedAt = Date.now();
    if (!handle) {
      return {
        matches: {},
        tournament_winner: [],
        source: "polymarket",
        generated_at: generatedAt,
      };
    }
    const matches: Record<
      string,
      {
        home_win: number | null;
        draw: number | null;
        away_win: number | null;
        source: "polymarket";
        updated_at: number;
      }
    > = {};
    for (let n = 1; n <= 72; n += 1) {
      const probs = loadMatchProbs(handle, `wc2026:match:${n}`);
      if (!probs) continue;
      matches[canonicalMatchKey(n)] = {
        home_win: probs.home_win,
        draw: probs.draw,
        away_win: probs.away_win,
        source: "polymarket",
        updated_at: probs.updated_at,
      };
    }
    const winner = loadWinnerMarket(handle);
    return {
      matches,
      tournament_winner: winner.map((e) => ({
        team_code: e.team_code,
        implied_prob: e.implied_prob,
      })),
      source: "polymarket",
      generated_at: generatedAt,
    };
  });
}
