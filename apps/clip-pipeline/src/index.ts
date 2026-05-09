#!/usr/bin/env node
/**
 * clip-pipeline entrypoint. Boots Fastify, mounts routes, attaches an in-process
 * queue + ffmpeg runner. The match-events fetcher is currently a stub that
 * returns an empty list — it'll be wired to the spec stream / replay store
 * once that surface stabilises (tracked in IDEAS.md → "clip-pipeline event
 * source"). Until then, callers can feed events through a future
 * `POST /v1/match/:id/events` endpoint or via direct fixture mounts.
 */

import { pino } from "pino";

import { buildApp } from "./api.js";
import { loadConfig } from "./config.js";
import { defaultFfmpegRunner } from "./ffmpeg.js";
import { ClipQueue } from "./queue.js";
import type { DetectorEvent } from "./types.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const log = pino({
    level: config.logLevel,
    base: { service: "clip-pipeline" },
  });
  log.info({ config: redact(config) }, "starting");

  const ffmpeg = defaultFfmpegRunner({ bin: config.ffmpegBin });
  const queue = new ClipQueue({
    ffmpeg,
    storagePath: config.storagePath,
    storageUrl: config.storageUrl,
  });

  const fetchEvents = async (matchId: string): Promise<ReadonlyArray<DetectorEvent>> => {
    log.warn({ matchId }, "no event source wired yet; returning empty list");
    return [];
  };

  const app = buildApp({ queue, ffmpeg, fetchEvents, log });
  await app.listen({ port: config.port, host: config.bind });
  log.info({ port: config.port, bind: config.bind }, "http server listening");

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    try {
      await app.close();
    } catch (e) {
      log.warn({ err: e }, "error closing http server");
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

function redact(config: ReturnType<typeof loadConfig>): unknown {
  return { ...config };
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("clip-pipeline fatal:", e);
  process.exit(1);
});
