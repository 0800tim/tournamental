/**
 * Fastify HTTP surface for the clip-pipeline service.
 *
 * Endpoints:
 *   POST /v1/clip                     queue a render
 *   GET  /v1/clip/:clip_id            poll status
 *   GET  /v1/clip/:clip_id/file       stream the rendered MP4
 *   GET  /v1/match/:match_id/highlights  detect highlights from a posted event stream
 *   GET  /healthz                     liveness + ffmpeg availability
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import type { Logger } from "pino";

import { detectHighlights } from "./highlights.js";
import type { SubscriptionManager } from "./lib/event-trigger.js";
import type { ClipQueue } from "./queue.js";
import type { FfmpegRunner } from "./ffmpeg.js";
import type {
  ClipFormat,
  ClipOverlay,
  ClipRequest,
  DetectorEvent,
  Highlight,
} from "./types.js";

export interface BuildAppOptions {
  queue: ClipQueue;
  ffmpeg: FfmpegRunner;
  /** Resolver called by GET /v1/match/:id/highlights to fetch the event stream. Tests inject a stub. */
  fetchEvents: (matchId: string) => Promise<ReadonlyArray<DetectorEvent>>;
  /** Optional auto-trigger manager. When supplied, /v1/auto-trigger/* + healthz expose it. */
  triggers?: SubscriptionManager;
  log?: Logger;
}

const VALID_FORMATS = new Set<ClipFormat>(["9:16", "1:1", "16:9"]);

const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 90_000; // 90s ceiling per docs/14 long-form variant

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
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

  // Swagger / OpenAPI MUST be awaited so its onRoute hook captures every
  // route registered after this line.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(swagger as any, {
    openapi: {
      openapi: "3.0.0",
      info: {
        title: "Clip-Pipeline API",
        description:
          "Highlight detection + ffmpeg clip render service for VTorn social distribution.",
        version: "0.1.0",
        license: { name: "Apache-2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
      },
      servers: [
        { url: "http://localhost:3385", description: "local dev" },
        { url: "https://vtorn-clip.aiva.nz", description: "dev tunnel" },
      ],
      tags: [{ name: "clips", description: "Clip queue + render" }],
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(swaggerUi as any, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: true },
    staticCSP: true,
  });

  app.get("/healthz", async () => {
    const ffmpegOk = await opts.ffmpeg.available();
    return {
      ok: true,
      ffmpeg: ffmpegOk ? "available" : "missing",
      active_triggers: opts.triggers?.count() ?? 0,
      ts: Date.now(),
    };
  });

  app.post<{ Body: unknown }>("/v1/clip", async (req, reply) => {
    const parsed = parseClipRequest(req.body);
    if ("error" in parsed) {
      reply.status(400);
      return { error: parsed.error };
    }
    const { job, cached } = opts.queue.submit(parsed.value);
    reply.status(cached ? 200 : 202);
    reply.header("Cache-Control", "no-store");
    return {
      clip_id: job.clip_id,
      status: job.status,
      cached,
    };
  });

  app.get<{ Params: { clip_id: string } }>("/v1/clip/:clip_id", async (req, reply) => {
    const job = opts.queue.get(req.params.clip_id);
    if (!job) {
      reply.status(404);
      return { error: `no such clip ${req.params.clip_id}` };
    }
    if (job.status === "done") {
      // Content-addressed → safe for ages.
      reply.header("Cache-Control", "public, max-age=300");
    } else {
      reply.header("Cache-Control", "no-store");
    }
    const body: Record<string, unknown> = {
      clip_id: job.clip_id,
      status: job.status,
      created_at: job.created_at,
      updated_at: job.updated_at,
      request: job.request,
    };
    if (job.url) body.url = job.url;
    if (job.thumbnail) body.thumbnail = job.thumbnail;
    if (job.error) body.error = job.error;
    return body;
  });

  app.get<{ Params: { clip_id: string } }>("/v1/clip/:clip_id/file", async (req, reply) => {
    const job = opts.queue.get(req.params.clip_id);
    if (!job) {
      reply.status(404);
      return { error: `no such clip ${req.params.clip_id}` };
    }
    if (job.status !== "done" || !job.output_path) {
      reply.status(409);
      return { error: `clip ${req.params.clip_id} is ${job.status}; not ready` };
    }
    let size: number;
    try {
      const s = await stat(job.output_path);
      size = s.size;
    } catch {
      reply.status(410);
      return { error: `clip file no longer on disk for ${req.params.clip_id}` };
    }
    reply.header("Content-Type", "video/mp4");
    reply.header("Content-Length", String(size));
    // Content-addressed by SHA → safe to cache forever.
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    return reply.send(createReadStream(job.output_path));
  });

  app.get<{ Params: { match_id: string }; Querystring: { limit?: string } }>(
    "/v1/match/:match_id/highlights",
    async (req, reply) => {
      const matchId = req.params.match_id;
      if (!matchId || matchId.length > 128) {
        reply.status(400);
        return { error: "match_id required (max 128 chars)" };
      }
      let events: ReadonlyArray<DetectorEvent>;
      try {
        events = await opts.fetchEvents(matchId);
      } catch (err) {
        reply.status(502);
        return { error: `event fetch failed: ${(err as Error).message}` };
      }
      const all = detectHighlights(events);
      const limit = req.query.limit ? Number(req.query.limit) : null;
      const out: Highlight[] =
        limit && Number.isFinite(limit) && limit > 0 ? all.slice(0, limit) : all;
      reply.header("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
      return { match_id: matchId, count: out.length, highlights: out };
    },
  );

  // -------- auto-trigger control --------

  app.post<{ Body: unknown }>("/v1/auto-trigger/start", async (req, reply) => {
    if (!opts.triggers) {
      reply.status(503);
      return { error: "auto-trigger not configured" };
    }
    const parsed = parseAutoTrigger(req.body);
    if ("error" in parsed) {
      reply.status(400);
      return { error: parsed.error };
    }
    try {
      await opts.triggers.start(parsed.value.matchId, parsed.value.streamUrl);
    } catch (err) {
      reply.status(502);
      return { error: `failed to start subscription: ${(err as Error).message}` };
    }
    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      matchId: parsed.value.matchId,
      streamUrl: parsed.value.streamUrl,
      active_triggers: opts.triggers.count(),
    };
  });

  app.post<{ Body: unknown }>("/v1/auto-trigger/stop", async (req, reply) => {
    if (!opts.triggers) {
      reply.status(503);
      return { error: "auto-trigger not configured" };
    }
    const parsed = parseAutoTriggerStop(req.body);
    if ("error" in parsed) {
      reply.status(400);
      return { error: parsed.error };
    }
    const stopped = await opts.triggers.stop(parsed.value.matchId);
    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      matchId: parsed.value.matchId,
      stopped,
      active_triggers: opts.triggers.count(),
    };
  });

  app.get("/v1/auto-trigger", async (_req, reply) => {
    if (!opts.triggers) {
      reply.status(503);
      return { error: "auto-trigger not configured" };
    }
    reply.header("Cache-Control", "no-store");
    return {
      count: opts.triggers.count(),
      subscriptions: opts.triggers.list(),
    };
  });

  return app;
}

// ---------- auto-trigger request parsing ----------

type ParsedAutoTrigger =
  | { value: { matchId: string; streamUrl: string } }
  | { error: string };

export function parseAutoTrigger(raw: unknown): ParsedAutoTrigger {
  if (!raw || typeof raw !== "object") {
    return { error: "body must be a JSON object" };
  }
  const r = raw as Record<string, unknown>;
  const matchId = r.matchId;
  if (typeof matchId !== "string" || matchId.length === 0 || matchId.length > 128) {
    return { error: "matchId must be a non-empty string (max 128 chars)" };
  }
  const streamUrl = r.streamUrl;
  if (typeof streamUrl !== "string" || streamUrl.length === 0 || streamUrl.length > 2048) {
    return { error: "streamUrl must be a non-empty string (max 2048 chars)" };
  }
  if (!/^wss?:\/\//.test(streamUrl)) {
    return { error: "streamUrl must start with ws:// or wss://" };
  }
  return { value: { matchId, streamUrl } };
}

type ParsedAutoTriggerStop = { value: { matchId: string } } | { error: string };

export function parseAutoTriggerStop(raw: unknown): ParsedAutoTriggerStop {
  if (!raw || typeof raw !== "object") {
    return { error: "body must be a JSON object" };
  }
  const r = raw as Record<string, unknown>;
  const matchId = r.matchId;
  if (typeof matchId !== "string" || matchId.length === 0 || matchId.length > 128) {
    return { error: "matchId must be a non-empty string (max 128 chars)" };
  }
  return { value: { matchId } };
}

// ---------- request parsing ----------

type ParsedRequest = { value: ClipRequest } | { error: string };

export function parseClipRequest(raw: unknown): ParsedRequest {
  if (!raw || typeof raw !== "object") {
    return { error: "body must be a JSON object" };
  }
  const r = raw as Record<string, unknown>;
  const match_id = r.match_id;
  if (typeof match_id !== "string" || match_id.length === 0 || match_id.length > 128) {
    return { error: "match_id must be a non-empty string (max 128 chars)" };
  }
  const start_ms = r.start_ms;
  const end_ms = r.end_ms;
  if (typeof start_ms !== "number" || !Number.isFinite(start_ms) || start_ms < 0) {
    return { error: "start_ms must be a non-negative number" };
  }
  if (typeof end_ms !== "number" || !Number.isFinite(end_ms) || end_ms <= start_ms) {
    return { error: "end_ms must be > start_ms" };
  }
  const dur = end_ms - start_ms;
  if (dur < MIN_DURATION_MS) {
    return { error: `clip duration must be >= ${MIN_DURATION_MS}ms (got ${dur})` };
  }
  if (dur > MAX_DURATION_MS) {
    return { error: `clip duration must be <= ${MAX_DURATION_MS}ms (got ${dur})` };
  }
  const format = r.format;
  if (typeof format !== "string" || !VALID_FORMATS.has(format as ClipFormat)) {
    return { error: `format must be one of ${[...VALID_FORMATS].join(", ")}` };
  }
  let overlay: ClipOverlay | undefined;
  if (r.overlay !== undefined && r.overlay !== null) {
    if (typeof r.overlay !== "object") {
      return { error: "overlay must be an object" };
    }
    const ov = r.overlay as Record<string, unknown>;
    overlay = {};
    for (const key of ["scoreline", "scorer", "minute", "language"] as const) {
      const v = ov[key];
      if (v === undefined || v === null) continue;
      if (typeof v !== "string" || v.length > 256) {
        return { error: `overlay.${key} must be a string (max 256 chars)` };
      }
      overlay[key] = v;
    }
  }
  let src: string | undefined;
  if (r.src !== undefined && r.src !== null) {
    if (typeof r.src !== "string" || r.src.length === 0 || r.src.length > 2048) {
      return { error: "src must be a non-empty string (max 2048 chars)" };
    }
    src = r.src;
  }

  const value: ClipRequest = {
    match_id,
    start_ms,
    end_ms,
    format: format as ClipFormat,
    ...(overlay ? { overlay } : {}),
    ...(src !== undefined ? { src } : {}),
  };
  return { value };
}
