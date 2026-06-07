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
import { createHmac } from "node:crypto";

import { loadFixtures2026 } from "@tournamental/bracket-engine";

import {
  globalKey,
  syndicateKey,
  type LeaderboardCache,
} from "../scoring/cache.js";
import { LeaderboardCache as BotArenaLeaderboardCache } from "../services/leaderboard-cache.js";
import type { GameStore } from "../store/db.js";
import type { LeaderboardRow } from "../types.js";

const TOP_N = 100;
const PUBLIC_CACHE_HEADER = "public, max-age=30, stale-while-revalidate=60";

/**
 * Per-tournament catalogue of fixture kickoff epoch-ms, sorted ascending.
 * Used to compute `matches_available_to_user` = count of fixtures whose
 * kickoff has happened AND landed strictly after the user's
 * `registered_at` timestamp. Cached for the process lifetime; FIFA
 * 2026 fixtures don't change.
 */
const kickoffCatalogueCache = new Map<string, readonly number[]>();

function kickoffCatalogue(tournamentId: string): readonly number[] {
  const cached = kickoffCatalogueCache.get(tournamentId);
  if (cached) return cached;
  const kickoffs: number[] = [];
  if (tournamentId === "fifa-wc-2026") {
    const tournament = loadFixtures2026();
    for (const f of tournament.group_fixtures) {
      const ms = Date.parse(f.kickoff_utc);
      if (!Number.isNaN(ms)) kickoffs.push(ms);
    }
    for (const k of tournament.knockouts) {
      if (!k.kickoff_utc) continue;
      const ms = Date.parse(k.kickoff_utc);
      if (!Number.isNaN(ms)) kickoffs.push(ms);
    }
    kickoffs.sort((a, b) => a - b);
  }
  kickoffCatalogueCache.set(tournamentId, kickoffs);
  return kickoffs;
}

/** Count of fixtures whose kickoff is <= `now` and > `registeredAt`. */
function matchesAvailableTo(
  tournamentId: string,
  registeredAt: number,
  now: number,
): number {
  const kickoffs = kickoffCatalogue(tournamentId);
  let count = 0;
  for (const k of kickoffs) {
    if (k <= now && k > registeredAt) count += 1;
  }
  return count;
}

/**
 * SEC-BRK-06: opaque per-user identifier emitted in place of the raw
 * `user_id`. HMAC keyed by `LEADERBOARD_HANDLE_SECRET` (or the admin
 * token as a sane fallback so dev / unit tests get a stable hash
 * without extra env vars). 8 hex chars = 32 bits — collisions are
 * possible at 65k entries (birthday) but the surface only needs
 * stability within a single leaderboard render, and the hash is one-
 * way so it can't be reversed into the auth-sms user id consumed by
 * the `/v1/bracket/by-guid/<user_id>` enumeration vector.
 */
function leaderboardHandleSecret(): string {
  return (
    process.env.LEADERBOARD_HANDLE_SECRET ||
    process.env.GAME_ADMIN_TOKEN ||
    "leaderboard-handle-dev-secret"
  );
}

function hashUserHandle(userId: string): string {
  return createHmac("sha256", leaderboardHandleSecret())
    .update(userId)
    .digest("hex")
    .slice(0, 8);
}

export interface LeaderboardRoutesDeps {
  readonly store: GameStore;
  readonly cache: LeaderboardCache;
}

/**
 * Bot Arena cache , partitioned per (tournament, scope, source). Lives
 * alongside the existing LeaderboardCache so the global syndicate and
 * tournament reads keep their current behaviour while the new
 * ?scope=humans|bots|all and ?source=federated paths get their own TTL
 * + prefix invalidation surface.
 */
const botArenaCache = new BotArenaLeaderboardCache({ defaultTtlMs: 30_000 });

/** Test helper , drop every Bot Arena cache entry. */
export function _resetBotArenaCache(): void {
  botArenaCache.clear();
}

export async function registerLeaderboardRoutes(
  app: FastifyInstance,
  deps: LeaderboardRoutesDeps,
): Promise<void> {
  app.get("/v1/leaderboard/:tournament_id", async (req, reply) => {
    const params = req.params as { tournament_id?: string };
    const query = req.query as {
      scope?: string;
      source?: string;
    };
    const tournamentId = (params.tournament_id ?? "").trim();
    if (!tournamentId) {
      return reply.code(400).send({ error: "invalid_tournament_id" });
    }

    // Bot Arena scope filter. When the caller asks for humans|bots|all
    // we route through the partitioned cache + scope-aware store
    // query and skip the legacy global cache + LeaderboardRow handle
    // path. Default (no scope param) preserves the v0.1 contract.
    const scopeRaw = (query?.scope ?? "").trim().toLowerCase();
    const source = (query?.source ?? "").trim().toLowerCase();
    if (
      source === "federated" ||
      scopeRaw === "humans" ||
      scopeRaw === "bots" ||
      scopeRaw === "all"
    ) {
      const scope: "humans" | "bots" | "all" =
        scopeRaw === "humans" || scopeRaw === "bots" || scopeRaw === "all"
          ? scopeRaw
          : "all";
      const key = `lb:${tournamentId}:${scope}:${source || "central"}`;
      const out = await botArenaCache.get(key, async () => {
        if (source === "federated") {
          return deps.store.federatedNodes.listFederatedTopK(TOP_N);
        }
        const rows = deps.store.topNByScope(tournamentId, scope, TOP_N);
        const now = Date.now();
        return rows.map((r, i) => ({
          rank: i + 1,
          user_handle: hashUserHandle(r.user_id),
          share_guid: r.share_guid,
          score_total: r.score_total,
          bracket_id: r.id,
          matches_available_to_user: matchesAvailableTo(
            tournamentId,
            r.joined_at,
            now,
          ),
        }));
      });
      reply.header("Cache-Control", PUBLIC_CACHE_HEADER);
      return {
        tournament_id: tournamentId,
        scope,
        source: source || "central",
        rows: out,
      };
    }

    const key = globalKey(tournamentId, TOP_N);
    const cached = deps.cache.get(key);
    if (cached) {
      reply.header("Cache-Control", PUBLIC_CACHE_HEADER);
      reply.header("X-Cache", "HIT");
      return { tournament_id: tournamentId, rows: cached };
    }
    const rows = deps.store.topN(tournamentId, TOP_N);
    const now = Date.now();
    const out: LeaderboardRow[] = rows.map((r, i) => ({
      rank: i + 1,
      user_handle: hashUserHandle(r.user_id),
      share_guid: r.share_guid,
      score_total: r.score_total,
      bracket_id: r.id,
      matches_available_to_user: matchesAvailableTo(
        tournamentId,
        r.joined_at,
        now,
      ),
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
      const now = Date.now();
      const out: LeaderboardRow[] = rows.map((r, i) => ({
        rank: i + 1,
        user_handle: hashUserHandle(r.user_id),
        share_guid: r.share_guid,
        score_total: r.score_total,
        bracket_id: r.id,
        matches_available_to_user: matchesAvailableTo(
          tournamentId,
          r.joined_at,
          now,
        ),
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
