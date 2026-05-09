/**
 * Process-config for the clip-pipeline service. Reads from `process.env` by
 * default; tests pass an env-shaped object directly so they don't pollute the
 * real process environment.
 */

export interface Config {
  port: number;
  bind: string;
  storagePath: string;
  ffmpegBin: string;
  /** Optional public URL prefix; trailing slash trimmed on load. */
  storageUrl: string | null;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number.parseInt(env.CLIP_PORT ?? "3380", 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65_535) {
    throw new Error(`CLIP_PORT must be a positive integer, got ${env.CLIP_PORT}`);
  }
  const storagePath = env.CLIP_STORAGE_PATH?.trim() || "./apps/clip-pipeline/data/clips";
  const ffmpegBin = env.CLIP_FFMPEG_BIN?.trim() || "ffmpeg";
  const rawUrl = env.CLIP_STORAGE_URL?.trim() || "";
  return {
    port,
    bind: env.CLIP_BIND?.trim() || "0.0.0.0",
    storagePath,
    ffmpegBin,
    storageUrl: rawUrl ? rawUrl.replace(/\/+$/, "") : null,
    logLevel: env.CLIP_LOG_LEVEL?.trim() || "info",
  };
}
