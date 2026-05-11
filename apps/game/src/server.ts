/**
 * Tournamental game service (Fastify) — port 3360 by default.
 *
 * What it does (per docs/12):
 *   - Accepts bracket submissions, persists them, returns lock receipts.
 *   - Records match results (admin-only) and recomputes affected
 *     brackets' scores using the canonical scoring engine.
 *   - Serves cached top-100 leaderboards (global + per-syndicate).
 *
 * What it intentionally doesn't do (yet):
 *   - Run the snapshotter from docs/12 (this is dev-scale; we'll switch
 *     to Redis ZSETs + flat-file snapshots when traffic warrants).
 *   - Authenticate users (read-only auth via X-User-Id header trusts the
 *     dev mesh; production wires this up via the Telegram Bot in doc 13).
 *
 * Env vars (see .env.example): GAME_PORT, GAME_BIND, GAME_DB_PATH,
 * GAME_ADMIN_TOKEN, GAME_LEADERBOARD_TTL_S, GAME_CORS_ORIGINS, LOG_LEVEL.
 */

import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";

import { registerHealth } from "./routes/health.js";
import { registerBracketRoutes } from "./routes/bracket.js";
import { registerBracketByGuidRoutes } from "./routes/bracket-by-guid.js";
import { registerMatchRoutes } from "./routes/match.js";
import { registerLeaderboardRoutes } from "./routes/leaderboard.js";
import { registerSyndicateRoutes } from "./routes/syndicate.js";
import { registerPunditRoutes } from "./routes/pundit.js";
import { registerPickRoutes } from "./routes/picks.js";
import { GameStore } from "./store/db.js";
import { LeaderboardCache } from "./scoring/cache.js";
import { recomputeVerifiedPundits } from "./pundit/compute.js";
import type { KickoffRegistry } from "./kickoffs.js";

export interface BuildServerOptions {
  /** Override DB path (e.g. ":memory:" for tests). Falls back to env. */
  dbPath?: string;
  /** Override migrations dir for tests. */
  migrationsDir?: string;
  /** Override the admin token (tests pass a known one). Falls back to env. */
  adminToken?: string | null;
  /** Override leaderboard cache TTL in milliseconds (tests). Falls back to env. */
  cacheTtlMs?: number;
  /** Override the clock (tests). */
  nowMs?: () => number;
  /** Whether to enable rate limiting (tests usually want false). */
  rateLimit?: boolean;
  /**
   * Override the kickoff registry. Tests pass a deterministic one;
   * production falls back to the WC2026 registry built from the vendored
   * fixture JSON in `@tournamental/bracket-engine`.
   */
  kickoffs?: KickoffRegistry;
  /**
   * Skip the boot-time Verified-Pundit recompute. Tests that don't care
   * about the badge surface set this to keep startup quiet.
   */
  skipPunditRecompute?: boolean;
  /** Override the JSONL audit-log path for the pundit compute (tests). */
  punditJsonlPath?: string;
}

export interface BuiltServer {
  app: FastifyInstance;
  store: GameStore;
  cache: LeaderboardCache;
}

export async function buildServer(opts: BuildServerOptions = {}): Promise<BuiltServer> {
  const dbPath = opts.dbPath ?? process.env.GAME_DB_PATH ?? "./apps/game/data/game.db";
  const adminToken =
    opts.adminToken !== undefined ? opts.adminToken : process.env.GAME_ADMIN_TOKEN || null;
  const cacheTtlMs =
    opts.cacheTtlMs ?? Number(process.env.GAME_LEADERBOARD_TTL_S ?? 30) * 1000;
  const corsOrigins = (process.env.GAME_CORS_ORIGINS ?? "https://play.tournamental.com,http://localhost:3300")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const useRateLimit = opts.rateLimit ?? true;

  const store = new GameStore({ dbPath, migrationsDir: opts.migrationsDir });
  const cache = new LeaderboardCache(cacheTtlMs);

  const usePretty = process.env.LOG_PRETTY === "1";
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      ...(usePretty ? { transport: { target: "pino-pretty" } } : {}),
    },
    disableRequestLogging: false,
    trustProxy: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      cb(null, corsOrigins.includes(origin));
    },
    credentials: true,
  });

  if (useRateLimit) {
    await app.register(rateLimit, {
      max: 1000,
      timeWindow: "1 minute",
      allowList: ["127.0.0.1", "::1"],
    });
  }

  await app.register(sensible);

  // Root descriptor — handy for ops sanity checks.
  app.get("/", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    return {
      service: "@vtorn/game",
      docs: "/v1",
      health: "/healthz",
    };
  });

  await registerHealth(app, store);
  await registerBracketRoutes(app, {
    store,
    nowMs: opts.nowMs,
    kickoffs: opts.kickoffs,
  });
  await registerBracketByGuidRoutes(app, { store });
  await registerPickRoutes(app, {
    store,
    nowMs: opts.nowMs,
    kickoffs: opts.kickoffs,
  });
  await registerMatchRoutes(app, { store, cache, adminToken, nowMs: opts.nowMs });
  await registerLeaderboardRoutes(app, { store, cache });
  await registerSyndicateRoutes(app, { store, adminToken });
  await registerPunditRoutes(app, {
    store,
    adminToken,
    nowMs: opts.nowMs,
    jsonlPath: opts.punditJsonlPath,
    // Tests pass `:memory:`; in that case avoid writing the audit file
    // to a shared location unless the caller explicitly opts in.
    suppressJsonl: opts.punditJsonlPath ? false : dbPath === ":memory:",
  });

  // Boot-time Verified-Pundit recompute. Cheap (top-100 scan per settled
  // tournament) and ensures the in-DB qualifier table is consistent with
  // the latest leaderboard state — useful after a manual re-score or a
  // schema migration.
  if (!opts.skipPunditRecompute) {
    try {
      // Boot recompute is in-DB only by default; the JSONL audit log is
      // owned by the admin settle endpoint so we don't accidentally append
      // a duplicate epoch line on every server restart.
      const result = recomputeVerifiedPundits({
        store,
        now: opts.nowMs,
        jsonlPath: opts.punditJsonlPath,
        suppressJsonl: opts.punditJsonlPath ? false : true,
      });
      app.log.info(
        {
          tournaments: result.tournamentsScanned,
          qualified: result.qualified,
        },
        "verified-pundit boot recompute",
      );
    } catch (err) {
      app.log.warn({ err }, "verified-pundit boot recompute failed");
    }
  }

  // Close the store when the server is closed so tests don't leak file
  // handles between describe blocks.
  app.addHook("onClose", async () => {
    store.close();
  });

  return { app, store, cache };
}

async function start() {
  const port = Number(process.env.GAME_PORT ?? 3360);
  const bind = process.env.GAME_BIND ?? "0.0.0.0";
  const built = await buildServer();
  try {
    await built.app.listen({ port, host: bind });
    built.app.log.info(
      { port, bind },
      `vtorn-game listening on http://${bind}:${port}`,
    );
  } catch (err) {
    built.app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
