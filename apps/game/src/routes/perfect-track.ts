/**
 * Public read endpoint for the perfect-track badge.
 *
 *   GET /v1/perfect-track , latest rolled-up alert summary
 *
 * Returns:
 *   {
 *     highest_match: number | null,
 *     total_alive:   number,
 *     operator_count: number,
 *     rows: Array<{ operator_id, match_number, alive_count, detected_at }>
 *   }
 *
 * Edge-cached because the badge polls on every leaderboard render.
 *
 * Spec: A13 task brief , "🔥 N bots still on a perfect track after
 * match X" badge.
 */
import type { FastifyInstance } from "fastify";

import type { GameStore } from "../store/db.js";

export interface PerfectTrackRoutesDeps {
  readonly store: GameStore;
}

export async function registerPerfectTrackRoutes(
  app: FastifyInstance,
  deps: PerfectTrackRoutesDeps,
): Promise<void> {
  app.get("/v1/perfect-track", async (_req, reply) => {
    reply.header(
      "Cache-Control",
      "public, s-maxage=30, stale-while-revalidate=120",
    );
    const summary = deps.store.perfectTrackAlerts.latestSummary();
    const rows = deps.store.perfectTrackAlerts.listAll();
    return {
      highest_match: summary?.highest_match ?? null,
      total_alive: summary?.total_alive ?? 0,
      operator_count: summary?.operator_count ?? 0,
      rows: rows.map((r) => ({
        operator_id: r.operator_id,
        match_number: r.match_number,
        alive_count: r.alive_count,
        detected_at: r.detected_at,
      })),
    };
  });
}
