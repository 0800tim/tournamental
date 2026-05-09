/**
 * Fastify HTTP + WebSocket server for the stream fan-out.
 *
 * Routes:
 *   GET  /                          — service descriptor.
 *   GET  /healthz                   — liveness probe.
 *   GET  /admin/status              — bearer-auth ops snapshot.
 *   WS   /v1/match/:match_id        — subscribe to a match's live stream.
 *
 * The WebSocket server is attached to Fastify's underlying HTTP server
 * via `noServer: true` — we handle the upgrade ourselves so we can
 * route by URL path, enforce per-IP/total caps, and reject upgrades to
 * unknown matches.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import Fastify, { type FastifyInstance } from "fastify";
import pino from "pino";
import { WebSocketServer, type WebSocket as WS } from "ws";
import { SPEC_VERSION } from "@vtorn/spec";
import { loadConfig, type StreamConfig } from "./config.js";
import { Pipeline } from "./pipeline.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, "../package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name: string; version: string };

export interface BuildOptions {
  config?: StreamConfig;
  pipeline?: Pipeline;
  /** If true, do not auto-start producers (tests inject manually). */
  startProducers?: boolean;
}

export interface BuiltServer {
  app: FastifyInstance;
  pipeline: Pipeline;
  wss: WebSocketServer;
  config: StreamConfig;
  /** Convenience: full lifecycle close. */
  shutdown: () => Promise<void>;
}

const MATCH_PATH_RE = /^\/v1\/match\/([A-Za-z0-9._:-]+)$/;

function clientIp(req: IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

export async function buildServer(opts: BuildOptions = {}): Promise<BuiltServer> {
  const config = opts.config ?? loadConfig();
  const logger = pino({
    level: config.logLevel,
    ...(config.logPretty ? { transport: { target: "pino-pretty" } } : {}),
  });

  const pipeline = opts.pipeline ?? new Pipeline({ config, logger });
  if (opts.startProducers !== false) {
    pipeline.start();
  }

  const app = Fastify({
    logger: {
      level: config.logLevel,
      ...(config.logPretty ? { transport: { target: "pino-pretty" } } : {}),
    },
    trustProxy: true,
    disableRequestLogging: false,
  });

  app.get("/", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=60");
    return {
      service: pkg.name,
      version: pkg.version,
      spec_version: SPEC_VERSION,
      docs: "https://github.com/0800tim/vtorn",
      healthz: "/healthz",
      admin: "/admin/status",
      subscribe: "/v1/match/:match_id (WebSocket)",
    };
  });

  app.get("/healthz", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    const statuses = pipeline.producerStatuses();
    const producersUp = statuses.filter((s) => s.state === "open").length;
    const ringAge = pipeline.freshestRingAgeMs();
    const ok = statuses.length === 0 ? true : producersUp > 0;
    reply.code(ok ? 200 : 503);
    return {
      ok,
      producers: statuses.length,
      producers_up: producersUp,
      subscribers: pipeline.hub.totalCount(),
      ring_age_ms: Number.isFinite(ringAge) ? ringAge : null,
    };
  });

  app.get("/admin/status", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!config.adminToken) {
      reply.code(503);
      return { error: "admin_disabled", hint: "set STREAM_ADMIN_TOKEN" };
    }
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${config.adminToken}`) {
      reply.code(401);
      return { error: "unauthorized" };
    }
    return {
      service: pkg.name,
      version: pkg.version,
      spec_version: SPEC_VERSION,
      uptime_ms: Math.round(process.uptime() * 1000),
      producers: pipeline.producerStatuses(),
      subscribers: pipeline.hub.totalCount(),
      subscriber_detail: pipeline.hub.describe(),
      matches: pipeline.matchIds().map((id) => {
        const ring = pipeline.getRing(id);
        return {
          match_id: id,
          subscribers: pipeline.hub.countByMatch(id),
          ring: ring?.summary() ?? null,
        };
      }),
      frame_rate: pipeline.frameRateHz(),
      ring_seconds: config.ringSeconds,
      dropped_frames: pipeline.hub.totalDropped(),
      limits: {
        per_ip: config.maxConnsPerIp,
        total: config.maxConnsTotal,
      },
    };
  });

  // -------- WebSocket upgrade handling --------

  const wss = new WebSocketServer({ noServer: true });

  // Wire up the underlying HTTP server's upgrade event once Fastify is ready.
  await app.ready();
  const httpServer = app.server;

  httpServer.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "/";
    const m = MATCH_PATH_RE.exec(url);
    if (!m) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const matchId = m[1]!;
    wss.handleUpgrade(req, socket, head, (ws) => {
      attachSubscriber(ws, req, matchId);
    });
  });

  function attachSubscriber(ws: WS, req: IncomingMessage, matchId: string): void {
    const ip = clientIp(req);
    const ring = pipeline.getRing(matchId);
    const subLogger = logger.child({ scope: "subscriber" });
    const result = pipeline.hub.add(
      {
        ws,
        matchId,
        ip,
        queueMax: config.subscriberQueueMax,
        stallMs: config.subscriberStallMs,
        logger: subLogger,
      },
      { perIp: config.maxConnsPerIp, total: config.maxConnsTotal },
    );
    if ("rejected" in result) {
      ws.send(JSON.stringify({ type: "x_error", error: result.rejected }));
      ws.close(1013, `rate_limit:${result.rejected}`);
      return;
    }
    // Hello message — small JSON envelope outside the spec namespace
    // (prefix with x_ so renderers ignore it harmlessly).
    const hello = {
      type: "x_hello" as const,
      service: pkg.name,
      version: pkg.version,
      spec_version: SPEC_VERSION,
      match_id: matchId,
      ring: ring?.summary() ?? {
        match_id: matchId,
        has_init: false,
        frames: 0,
        span_ms: 0,
        t_newest: 0,
        t_oldest: 0,
        age_ms: 0,
      },
    };
    try {
      ws.send(JSON.stringify(hello));
    } catch {
      /* ignore */
    }
    if (ring) {
      result.primeFromRing(ring);
    }
  }

  const shutdown = async (): Promise<void> => {
    pipeline.stop();
    wss.close();
    await app.close();
  };

  return { app, pipeline, wss, config, shutdown };
}

async function start() {
  const built = await buildServer();
  try {
    await built.app.listen({ port: built.config.port, host: built.config.bind });
    built.app.log.info(
      {
        port: built.config.port,
        bind: built.config.bind,
        producers: built.config.producerUrls,
        ringSeconds: built.config.ringSeconds,
      },
      `vtorn-stream-server listening on ws://${built.config.bind}:${built.config.port}/v1/match/:match_id`,
    );
  } catch (err) {
    built.app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void start();
}
