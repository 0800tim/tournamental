/**
 * Match-result settlement (admin-only).
 *
 *   POST /v1/match/:match_id/result
 *
 * Records the actual outcome of a match and re-scores every bracket that
 * had a prediction touching this match. The leaderboard cache is
 * invalidated so the next leaderboard read sees fresh numbers.
 *
 * Re-scoring touches every bracket for the tournament — fine for
 * dev/staging scale (a few hundred to a few thousand brackets). For prod
 * we'll switch to the snapshotter pattern in docs/12. Marked TODO inside.
 */

import type { FastifyInstance } from "fastify";

import { matchResultBodySchema } from "../schemas.js";
import type { GameStore } from "../store/db.js";
import type { LeaderboardCache } from "../scoring/cache.js";
import { computeBracketScore } from "../scoring/recompute.js";
import type { Bracket, MatchOutcome } from "../types.js";
import { makeAdminGuard } from "./auth.js";

export interface MatchRoutesDeps {
  readonly store: GameStore;
  readonly cache: LeaderboardCache;
  readonly adminToken: string | null;
  readonly nowMs?: () => number;
}

export async function registerMatchRoutes(
  app: FastifyInstance,
  deps: MatchRoutesDeps,
): Promise<void> {
  const now = deps.nowMs ?? (() => Date.now());
  const guard = makeAdminGuard({ token: deps.adminToken });

  app.post(
    "/v1/match/:match_id/result",
    { preHandler: guard },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const params = req.params as { match_id?: string };
      const matchId = params.match_id ?? "";
      if (!matchId || matchId.length > 64) {
        return reply.code(400).send({ error: "invalid_match_id" });
      }
      const parsed = matchResultBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_payload",
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
            code: i.code,
          })),
        });
      }
      const body = parsed.data;
      const outcome: MatchOutcome = {
        outcome: body.outcome,
        homeScore: body.homeScore,
        awayScore: body.awayScore,
        winner: body.winner,
        stage: body.stage,
        impliedAtLock: body.impliedAtLock,
        secondsSinceLock: body.secondsSinceLock,
        windowSeconds: body.windowSeconds,
      };

      // Persist the result.
      deps.store.upsertMatchResult({
        matchId,
        tournamentId: body.tournament_id,
        outcome,
        recordedAt: now(),
      });

      // Re-score every bracket that touches this match.
      // TODO(prod): replace with the snapshotter pattern from docs/12 —
      //   ZSET update + diff queue rather than full re-scan. Fine at
      //   dev/staging volumes.
      const allResults = deps.store.listMatchResults(body.tournament_id);
      const resultsMap = new Map<string, MatchOutcome>();
      for (const r of allResults) {
        try {
          resultsMap.set(r.match_id, JSON.parse(r.outcome) as MatchOutcome);
        } catch {
          // skip corrupt rows; never break re-scoring on a single bad row
        }
      }

      const brackets = deps.store.listBracketsForTournament(body.tournament_id);
      let rescored = 0;
      deps.store.transaction(() => {
        for (const row of brackets) {
          let bracket: Bracket;
          try {
            bracket = JSON.parse(row.payload_json) as Bracket;
          } catch {
            continue;
          }
          // Only rescore brackets that actually predicted this match — saves
          // work and matches the docs/12 spec.
          const touchesGroup = !!bracket.matchPredictions?.[matchId];
          const touchesKnockout = !!bracket.knockoutPredictions?.[matchId];
          if (!touchesGroup && !touchesKnockout) continue;
          const { total } = computeBracketScore({ bracket, results: resultsMap });
          deps.store.updateBracketScore(row.id, total);
          rescored++;
        }
      });

      deps.cache.invalidateTournament(body.tournament_id);

      return reply.code(200).send({
        match_id: matchId,
        tournament_id: body.tournament_id,
        recorded_at: new Date(now()).toISOString(),
        rescored_brackets: rescored,
      });
    },
  );
}
