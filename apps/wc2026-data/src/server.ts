/**
 * wc2026-data live HTTP service. Default port 3411.
 *
 * Endpoints:
 *   GET  /healthz                                — liveness probe
 *   GET  /v1/version                             — version / backend info
 *   GET  /v1/upcoming?limit=N                    — next-N fixtures
 *   GET  /v1/match/:id                           — single-match snapshot
 *   GET  /v1/match/:id/stream                    — Server-Sent Events feed
 *   POST /v1/admin/reset (opt: x-internal-secret) — reset mock state machine
 *
 * Backend selected via `WC2026_DATA_BACKEND` env: mock | sportradar |
 * apifootball. Defaults to "mock".
 *
 * Settlement bridge is wired automatically when `WC2026_GAME_BASE_URL` is
 * set. The bridge POSTs to apps/game's `/v1/match/:id/result` on each
 * unique `final` snapshot.
 */

import Fastify, { type FastifyInstance } from "fastify";

import { buildProvider, parseBackend } from "./live/provider.js";
import { SettlementBridge } from "./settlement-bridge.js";
import type { LiveDataProvider, LiveMatchState } from "./live/types.js";
import { registerSwagger } from "./swagger.js";

const PKG_VERSION = "0.1.0";

export interface BuildServerOptions {
  /** Override env (tests). Defaults to process.env. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Inject a provider directly (tests). Bypasses backend selection. */
  readonly provider?: LiveDataProvider;
  /** Inject a settlement bridge (tests). */
  readonly bridge?: SettlementBridge | null;
}

export interface BuiltServer {
  readonly app: FastifyInstance;
  readonly provider: LiveDataProvider;
  readonly bridge: SettlementBridge | null;
}

/**
 * Build the fastify instance. Caller is responsible for `.listen(...)`.
 * Returning the instance (rather than auto-listening) keeps tests
 * trivially clean via `app.inject(...)`.
 */
export async function buildServer(opts: BuildServerOptions = {}): Promise<BuiltServer> {
  const env = opts.env ?? process.env;
  const backend = parseBackend(env.WC2026_DATA_BACKEND);
  const provider = opts.provider ?? buildProvider({ env });
  const bridge =
    opts.bridge !== undefined
      ? opts.bridge
      : env.WC2026_GAME_BASE_URL
        ? new SettlementBridge({
            gameBaseUrl: env.WC2026_GAME_BASE_URL,
            gameInternalSecret: env.WC2026_GAME_INTERNAL_SECRET,
            tournamentId: env.WC2026_TOURNAMENT_ID ?? "fifa-wc-2026",
          })
        : null;
  const adminSecret = env.WC2026_DATA_ADMIN_SECRET ?? "";

  const app = Fastify({ logger: { level: env.LOG_LEVEL ?? "info" } });

  await registerSwagger(app);

  // ---------- health + version ----------

  app.get("/healthz", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    return { ok: true, backend, ts: new Date().toISOString() };
  });

  app.get("/v1/version", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    return { version: PKG_VERSION, backend, providerName: provider.name };
  });

  // ---------- upcoming + single fixture ----------

  app.get("/v1/upcoming", async (req, reply) => {
    const q = (req.query as { limit?: string }) ?? {};
    const limitNum = Number.parseInt(q.limit ?? "16", 10);
    const limit = Number.isFinite(limitNum) ? Math.max(1, Math.min(104, limitNum)) : 16;
    const fixtures = await provider.fetchUpcoming(limit);
    reply.header("Cache-Control", "public, s-maxage=15, stale-while-revalidate=60");
    return { backend, fixtures };
  });

  app.get("/v1/match/:id", async (req, reply) => {
    const id = (req.params as { id?: string }).id ?? "";
    if (!id || id.length > 64) {
      return reply.code(400).send({ error: "invalid_match_id" });
    }
    try {
      const state = await provider.fetchMatch(id);
      reply.header("Cache-Control", "no-store");
      return { backend, state };
    } catch (err) {
      const msg = (err as Error).message;
      if (/MissingApiKeyError|requires WC2026_DATA_API_KEY/i.test(msg)) {
        return reply.code(503).send({ error: "missing_api_key", detail: msg });
      }
      return reply.code(404).send({ error: "match_not_found", detail: msg });
    }
  });

  // ---------- SSE stream ----------

  app.get("/v1/match/:id/stream", async (req, reply) => {
    const id = (req.params as { id?: string }).id ?? "";
    if (!id || id.length > 64) {
      return reply.code(400).send({ error: "invalid_match_id" });
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    reply.raw.write(`event: ready\ndata: ${JSON.stringify({ matchId: id, backend })}\n\n`);

    const onUpdate = (state: LiveMatchState): void => {
      // Bridge fires lazily; failure does not break SSE delivery.
      if (bridge) void bridge.onMatchUpdate(state).catch(() => {});
      const line = `data: ${JSON.stringify(state)}\n\n`;
      try {
        reply.raw.write(line);
      } catch {
        /* socket closed; teardown happens via 'close' below */
      }
    };

    let unsubscribe: () => void;
    try {
      unsubscribe = provider.subscribeMatch(id, onUpdate);
    } catch (err) {
      reply.raw.write(
        `event: error\ndata: ${JSON.stringify({ error: (err as Error).message })}\n\n`,
      );
      reply.raw.end();
      return reply;
    }

    const teardown = (): void => {
      try {
        unsubscribe();
      } catch {
        // ignore
      }
    };
    req.raw.on("close", teardown);
    req.raw.on("aborted", teardown);
    // Don't return; stream keeps the response open until the client closes.
    return reply;
  });

  // ---------- admin / dev ----------

  app.post("/v1/admin/reset", async (req, reply) => {
    if (adminSecret) {
      const got = (req.headers["x-internal-secret"] ?? "") as string;
      if (got !== adminSecret) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    }
    // Mock-only: reset all match states.
    if ("resetAll" in provider && typeof (provider as { resetAll?: () => void }).resetAll === "function") {
      (provider as { resetAll: () => void }).resetAll();
      return { ok: true, backend, scope: "all" };
    }
    return reply.code(400).send({ error: "reset_unsupported_for_backend", backend });
  });

  return { app, provider, bridge };
}

/**
 * Entrypoint for `node dist/server.js` and `tsx watch src/server.ts`.
 */
async function main(): Promise<void> {
  const { app } = await buildServer();
  const port = Number.parseInt(process.env.PORT ?? "3411", 10);
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`wc2026-data live service listening on :${port}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
