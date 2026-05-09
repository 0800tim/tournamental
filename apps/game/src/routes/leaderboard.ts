/**
 * Leaderboard read routes.
 *
 *   GET /v1/leaderboard/:tournament_id
 *   GET /v1/leaderboard/:tournament_id/syndicate/:syndicate_id
 *
 * Both serve the top-100. Cached in-process for `ttl_ms` (default 30s) so
 * a thousand concurrent bot polls hit one SQL query, not a thousand. The
 * cache is invalidated on every match-result POST.
 *
 * Caching matrix (per CLAUDE.md):
 *   - Cache-Control: public, max-age=30, stale-while-revalidate=60
 *   - This is the canonical "API list/aggregate" surface — short TTL +
 *     SWR is exactly what docs/22 says we want.
 */

import type { FastifyInstance } from "fastify";

import {
  globalKey,
  syndicateKey,
  type LeaderboardCache,
} from "../scoring/cache.js";
import type { GameStore } from "../store/db.js";
import type { LeaderboardRow } from "../types.js";

const TOP_N = 100;
const PUBLIC_CACHE_HEADER = "public, max-age=30, stale-while-revalidate=60";

export interface LeaderboardRoutesDeps {
  readonly store: GameStore;
  readonly cache: LeaderboardCache;
}

export async function registerLeaderboardRoutes(
  app: FastifyInstance,
  deps: LeaderboardRoutesDeps,
): Promise<void> {
  app.get("/v1/leaderboard/:tournament_id", async (req, reply) => {
    const params = req.params as { tournament_id?: string };
    const tournamentId = (params.tournament_id ?? "").trim();
    if (!tournamentId) {
      return reply.code(400).send({ error: "invalid_tournament_id" });
    }
    const key = globalKey(tournamentId, TOP_N);
    const cached = deps.cache.get(key);
    if (cached) {
      reply.header("Cache-Control", PUBLIC_CACHE_HEADER);
      reply.header("X-Cache", "HIT");
      return { tournament_id: tournamentId, rows: cached };
    }
    const rows = deps.store.topN(tournamentId, TOP_N);
    const out: LeaderboardRow[] = rows.map((r, i) => ({
      rank: i + 1,
      user_id: r.user_id,
      score_total: r.score_total,
      bracket_id: r.id,
    }));
    deps.cache.set(key, out);
    reply.header("Cache-Control", PUBLIC_CACHE_HEADER);
    reply.header("X-Cache", "MISS");
    return { tournament_id: tournamentId, rows: out };
  });

  app.get(
    "/v1/leaderboard/:tournament_id/syndicate/:syndicate_id",
    async (req, reply) => {
      const params = req.params as {
        tournament_id?: string;
        syndicate_id?: string;
      };
      const tournamentId = (params.tournament_id ?? "").trim();
      const syndicateId = (params.syndicate_id ?? "").trim();
      if (!tournamentId) {
        return reply.code(400).send({ error: "invalid_tournament_id" });
      }
      if (!syndicateId) {
        return reply.code(400).send({ error: "invalid_syndicate_id" });
      }
      const key = syndicateKey(tournamentId, syndicateId, TOP_N);
      const cached = deps.cache.get(key);
      if (cached) {
        reply.header("Cache-Control", PUBLIC_CACHE_HEADER);
        reply.header("X-Cache", "HIT");
        return {
          tournament_id: tournamentId,
          syndicate_id: syndicateId,
          rows: cached,
        };
      }
      const rows = deps.store.topNForSyndicate(tournamentId, syndicateId, TOP_N);
      const out: LeaderboardRow[] = rows.map((r, i) => ({
        rank: i + 1,
        user_id: r.user_id,
        score_total: r.score_total,
        bracket_id: r.id,
      }));
      deps.cache.set(key, out);
      reply.header("Cache-Control", PUBLIC_CACHE_HEADER);
      reply.header("X-Cache", "MISS");
      return {
        tournament_id: tournamentId,
        syndicate_id: syndicateId,
        rows: out,
      };
    },
  );
}
