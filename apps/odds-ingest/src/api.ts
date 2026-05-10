/**
 * Fastify HTTP server. Exposes the read API for the bracket page and other
 * VTourn surfaces. CORS is wide-open — these are public, anonymised
 * prediction-market numbers with no PII.
 */

import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import type { Logger } from "pino";

import { buildMarketId } from "./normalise.js";
import type { DataPack } from "./data.js";
import type { IngestPoller } from "./poller.js";
import type { OddsStore } from "./store/sqlite.js";
import type { MatchOddsResponse, OddsMarket, OddsTick, SourceHealth } from "./types.js";

export interface ApiOptions {
  store: OddsStore;
  data: DataPack;
  poller: IngestPoller | null;
  log?: Logger;
  /** Override for tests (avoids tight coupling to live SourceHealth shape). */
  sourceHealth?: () => SourceHealth;
}

export async function buildApp(opts: ApiOptions): Promise<FastifyInstance> {
  // Fastify v5 expects an object config or `false`; an external pino instance
  // goes via `loggerInstance`. We default to `false` and let the caller wire
  // request-level logging if it cares. The cast bridges pino's Logger type
  // to fastify's stricter FastifyBaseLogger expectations.
  const app = Fastify(
    opts.log
      ? {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          loggerInstance: opts.log as unknown as any,
          disableRequestLogging: true,
        }
      : { logger: false, disableRequestLogging: true },
  );

  await app.register(cors, { origin: true });

  // Swagger MUST be awaited so its onRoute hook captures every route below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(swagger as any, {
    openapi: {
      openapi: "3.0.0",
      info: {
        title: "Odds-Ingest API",
        description:
          "Live prediction-market odds ingest for the VTorn 2026 World Cup bracket.",
        version: "0.1.0",
        license: { name: "Apache-2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
      },
      servers: [
        { url: "http://localhost:3375", description: "local dev" },
        { url: "https://vtorn-odds.aiva.nz", description: "dev tunnel" },
      ],
      tags: [{ name: "odds", description: "Match-level odds reads" }],
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(swaggerUi as any, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: true },
    staticCSP: true,
  });

  const sourceHealth =
    opts.sourceHealth ??
    (() => (opts.poller ? opts.poller.getStatus().source : { polymarket: "down", theoddsapi: "down", mock: "live" } as SourceHealth));

  app.get("/healthz", async () => ({
    ok: true,
    source_status: sourceHealth(),
    ts: Date.now(),
  }));

  app.get<{ Params: { matchNo: string } }>("/v1/odds/match/:matchNo", async (req, reply) => {
    const matchNo = Number(req.params.matchNo);
    if (!Number.isFinite(matchNo) || matchNo <= 0) {
      reply.status(400);
      return { error: "matchNo must be a positive integer" };
    }
    const fixture = opts.data.byMatchNumber.get(matchNo);
    if (!fixture) {
      reply.status(404);
      return { error: `no fixture with match_number ${matchNo}` };
    }
    const id = buildMarketId("match_moneyline", { match_no: matchNo });
    const market = opts.store.getMarket(id);
    const ticks = opts.store.latestTicks(id);
    const home = opts.data.byCode.get(fixture.home_team_slot);
    const away = opts.data.byCode.get(fixture.away_team_slot);
    if (!home || !away) {
      reply.status(404);
      return {
        error: "team_slot is a placeholder (knockout TBD); no live odds yet",
        match_no: matchNo,
      };
    }
    const probMap = ticksToProbMap(ticks);
    const homeProb = probMap.get(home.name) ?? probMap.get(home.code) ?? null;
    const awayProb = probMap.get(away.name) ?? probMap.get(away.code) ?? null;
    const drawProb = probMap.get("Draw") ?? probMap.get("draw") ?? null;

    if (homeProb == null || awayProb == null) {
      // Graceful fallback — odds aren't ingested yet.
      reply.header("Cache-Control", "public, s-maxage=10, stale-while-revalidate=60");
      return {
        match_no: matchNo,
        kickoff: fixture.kickoff_utc,
        source: null,
        ts: null,
        home: { code: home.code, name: home.name, prob: null },
        draw: null,
        away: { code: away.code, name: away.name, prob: null },
        note: "no live odds yet — market may not be published or fixture is too far out",
      };
    }
    const ts = Math.max(...ticks.map((t) => t.ts));
    const response: MatchOddsResponse = {
      match_no: matchNo,
      kickoff: fixture.kickoff_utc,
      source: (market?.source ?? "mock") as MatchOddsResponse["source"],
      ts,
      home: { code: home.code, name: home.name, prob: round4(homeProb) },
      draw: drawProb != null ? { prob: round4(drawProb) } : null,
      away: { code: away.code, name: away.name, prob: round4(awayProb) },
    };
    reply.header("Cache-Control", "public, s-maxage=20, stale-while-revalidate=60");
    return response;
  });

  app.get<{ Params: { code: string } }>("/v1/odds/team/:code/winner", async (req, reply) => {
    const code = req.params.code.toUpperCase();
    const team = opts.data.byCode.get(code);
    if (!team) {
      reply.status(404);
      return { error: `unknown team code ${code}` };
    }
    const id = buildMarketId("tournament_winner", { team_code: code });
    return tournamentOrGroup(opts, id, team.name, "winner");
  });

  app.get<{ Params: { code: string } }>("/v1/odds/team/:code/group", async (req, reply) => {
    const code = req.params.code.toUpperCase();
    const team = opts.data.byCode.get(code);
    if (!team) {
      reply.status(404);
      return { error: `unknown team code ${code}` };
    }
    const id = buildMarketId("group_winner", { team_code: code });
    return tournamentOrGroup(opts, id, team.name, "group");
  });

  app.get<{ Querystring: { kind?: string } }>("/v1/odds/markets", async (req, reply) => {
    const kind = req.query.kind;
    const markets = opts.store.listMarkets(kind ? { kind } : {});
    reply.header("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");
    return {
      count: markets.length,
      markets: markets.map((m) => marketSummary(m, opts.store)),
    };
  });

  app.get("/v1/odds/snapshot", async (_req, reply) => {
    const ticks = opts.store.latestTicksAll();
    const markets = new Map(opts.store.listMarkets().map((m) => [m.id, m]));
    const out: Record<string, Record<string, number>> = {};
    for (const t of ticks) {
      out[t.market_id] ??= {};
      out[t.market_id]![t.outcome_label] = round4(t.implied_prob);
    }
    reply.header("Cache-Control", "public, s-maxage=15, stale-while-revalidate=60");
    return {
      ts: Date.now(),
      market_count: markets.size,
      probabilities: out,
    };
  });

  return app;
}

function tournamentOrGroup(
  opts: ApiOptions,
  id: string,
  teamName: string,
  kind: "winner" | "group",
) {
  const market = opts.store.getMarket(id);
  const ticks = opts.store.latestTicks(id);
  if (!market || ticks.length === 0) {
    return {
      market_id: id,
      kind,
      team_name: teamName,
      source: null,
      prob: null,
      note: "no market yet",
    };
  }
  const probMap = ticksToProbMap(ticks);
  const yesProb = probMap.get("Yes") ?? probMap.get("yes") ?? null;
  return {
    market_id: id,
    kind,
    team_name: teamName,
    source: market.source,
    ts: Math.max(...ticks.map((t) => t.ts)),
    prob: yesProb != null ? round4(yesProb) : null,
  };
}

function marketSummary(m: OddsMarket, store: OddsStore) {
  const ticks = store.latestTicks(m.id);
  const probMap = ticksToProbMap(ticks);
  const probs: Record<string, number> = {};
  for (const [label, p] of probMap) probs[label] = round4(p);
  return {
    id: m.id,
    source: m.source,
    source_id: m.source_id,
    match_id: m.match_id,
    kind: m.kind,
    question: m.question,
    starts_at: m.starts_at,
    ends_at: m.ends_at,
    resolved: m.resolved,
    outcomes: m.outcomes,
    probs,
    updated_at: m.updated_at,
  };
}

function ticksToProbMap(ticks: OddsTick[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of ticks) m.set(t.outcome_label, t.implied_prob);
  return m;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
