/**
 * Verified-Pundit read + admin routes.
 *
 *   GET  /v1/users/:userId/pundit         — public, 60s cache
 *   POST /v1/admin/tournaments/:id/settle — admin-only, marks a
 *                                            tournament settled and runs
 *                                            the pundit recompute.
 *
 * The status payload is intentionally compact (verified / levels /
 * sinceDate / tournaments) so it's safe to inline on every page that
 * shows the user's name. Future-revenue-share hook (Drips Network — see
 * docs/19) will read this same surface; no payouts are wired here.
 *
 * Cache policy: per CLAUDE.md docs/22 the user-pundit endpoint is a
 * staleness-tolerant aggregate. We use `public, max-age=60,
 * stale-while-revalidate=120` and an in-process map so a thousand
 * concurrent leaderboard polls hit one SQL query, not a thousand.
 */

import type { FastifyInstance } from "fastify";

import type { GameStore } from "../store/db.js";
import { recomputeVerifiedPundits, rollupPunditStatus, type PunditStatus } from "../pundit/compute.js";
import { makeAdminGuard } from "./auth.js";

const PUBLIC_CACHE_HEADER = "public, max-age=60, stale-while-revalidate=120";
const TTL_MS = 60_000;

interface CacheEntry {
  status: PunditStatus;
  expiresAt: number;
}

export interface PunditRoutesDeps {
  readonly store: GameStore;
  readonly adminToken: string | null;
  readonly nowMs?: () => number;
  /** TTL override for tests. */
  readonly ttlMs?: number;
  /** Path for the JSONL audit log written on settle. Tests use a tmp dir. */
  readonly jsonlPath?: string;
  /** Skip JSONL writing (e.g. tests that don't care about the audit file). */
  readonly suppressJsonl?: boolean;
}

export async function registerPunditRoutes(
  app: FastifyInstance,
  deps: PunditRoutesDeps,
): Promise<void> {
  const now = deps.nowMs ?? (() => Date.now());
  const ttl = deps.ttlMs ?? TTL_MS;
  const cache = new Map<string, CacheEntry>();
  const guard = makeAdminGuard({ token: deps.adminToken });

  app.get("/v1/users/:userId/pundit", async (req, reply) => {
    const params = req.params as { userId?: string };
    const userId = (params.userId ?? "").trim();
    if (!userId) {
      return reply.code(400).send({ error: "invalid_user_id" });
    }
    const cached = cache.get(userId);
    if (cached && cached.expiresAt > now()) {
      reply.header("Cache-Control", PUBLIC_CACHE_HEADER);
      reply.header("X-Cache", "HIT");
      return cached.status;
    }
    const records = deps.store.listPunditRecordsForUser(userId);
    const status = rollupPunditStatus(records);
    cache.set(userId, { status, expiresAt: now() + ttl });
    reply.header("Cache-Control", PUBLIC_CACHE_HEADER);
    reply.header("X-Cache", "MISS");
    return status;
  });

  app.post(
    "/v1/admin/tournaments/:tournament_id/settle",
    { preHandler: guard },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const params = req.params as { tournament_id?: string };
      const tournamentId = (params.tournament_id ?? "").trim();
      if (!tournamentId) {
        return reply.code(400).send({ error: "invalid_tournament_id" });
      }
      const body = (req.body ?? {}) as { name?: string };
      // Register the tournament if the admin caller passed a display name.
      if (body.name) {
        deps.store.upsertTournament({ id: tournamentId, name: body.name });
      }
      deps.store.markTournamentSettled(tournamentId, now());
      const result = recomputeVerifiedPundits({
        store: deps.store,
        now,
        jsonlPath: deps.jsonlPath,
        suppressJsonl: deps.suppressJsonl,
      });
      // Wipe the cache so the next read sees the fresh qualifications.
      cache.clear();
      return reply.code(200).send({
        tournament_id: tournamentId,
        settled_at: new Date(now()).toISOString(),
        compute: {
          tournaments_scanned: result.tournamentsScanned,
          qualified: result.qualified,
        },
      });
    },
  );
}
