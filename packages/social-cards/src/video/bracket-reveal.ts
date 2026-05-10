/**
 * 6-second animated bracket-reveal MP4 generator.
 *
 * Pipeline (per Tim's brief — *no* external API spend):
 *   1. For each frame (default 24fps × 6s = 144 frames):
 *      - Create a fresh `@napi-rs/canvas` canvas at the target size.
 *      - Compose the bracket layout with `progress = frameIdx / total`.
 *      - Encode the canvas to PNG bytes.
 *   2. Spawn `ffmpeg -f image2pipe -framerate <fps> -i - -c:v libx264
 *      -pix_fmt yuv420p -movflags +faststart <output>`.
 *   3. Pipe each PNG to ffmpeg's stdin in order.
 *   4. Close stdin. Wait for ffmpeg to exit. Stat the output.
 *
 * The timing curve is a hand-tuned reveal — see the comments inside
 * `paintBracketFrame` for the per-element fades. The sub-windows are
 * encoded in the layout function, so the only thing this module owns
 * is "advance progress linearly per frame".
 *
 * Format presets:
 *   - `instagram` (1080 × 1350, 4:5)
 *   - `tiktok`    (1080 × 1920, 9:16 — Reels-compatible)
 *   - `twitter`   (1200 × 630, landscape 16:9-ish)
 *
 * Test seam: the spawning of ffmpeg is delegated to the optional
 * `spawnFn` argument so unit tests can mock it. Production callers
 * leave it unset and we spawn the real binary.
 */

import { createCanvas } from "@napi-rs/canvas";
import { spawn as defaultSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";

import { paintBracketFrame } from "../canvas/bracket-share-card.js";
import type { BracketShareCardInput, CanvasCardSize } from "../canvas/types.js";

export type VideoFormat = "instagram" | "tiktok" | "twitter";

export interface BracketRevealVideoInput {
  /** Same payload as the static PNG renderer. */
  readonly card: BracketShareCardInput;
  /** Frame rate. Default 24fps. */
  readonly fps?: number;
  /** Duration in seconds. Default 6s. */
  readonly durationSec?: number;
  /** Absolute path where the MP4 should land. */
  readonly outputPath: string;
  /** Target social platform. Drives the canvas size. */
  readonly format?: VideoFormat;
  /**
   * Optional override for ffmpeg's binary path. Resolved by default
   * via `which ffmpeg`, falling back to `/usr/bin/ffmpeg`.
   */
  readonly ffmpegPath?: string;
  /**
   * Test seam — replace `child_process.spawn`.
   */
  readonly spawnFn?: typeof defaultSpawn;
}

export interface BracketRevealVideoResult {
  readonly path: string;
  readonly sizeBytes: number;
  readonly durationSec: number;
  readonly fps: number;
  readonly frameCount: number;
  readonly width: number;
  readonly height: number;
}

const FORMAT_DIMENSIONS: Readonly<
  Record<VideoFormat, { width: number; height: number; size: CanvasCardSize }>
> = {
  instagram: { width: 1080, height: 1350, size: "portrait" },
  tiktok: { width: 1080, height: 1920, size: "portrait" },
  twitter: { width: 1200, height: 630, size: "landscape" },
};

/**
 * Render a 6-second animated MP4 of the user's bracket. See file header
 * for the timing curve. Returns the on-disk path + size on success.
 */
export async function renderBracketRevealVideo(
  input: BracketRevealVideoInput,
): Promise<BracketRevealVideoResult> {
  const fps = Math.max(1, Math.round(input.fps ?? 24));
  const durationSec = Math.max(0.5, input.durationSec ?? 6);
  const totalFrames = Math.round(fps * durationSec);
  const format = input.format ?? "instagram";
  const dims = FORMAT_DIMENSIONS[format];
  const outputPath = input.outputPath;

  // Resolve ffmpeg binary (with a real-world fallback).
  const ffmpegBin = input.ffmpegPath ?? "/usr/bin/ffmpeg";
  const spawn = input.spawnFn ?? defaultSpawn;

  const child: ChildProcess = spawn(
    ffmpegBin,
    [
      "-y", // overwrite
      "-f", "image2pipe",
      "-framerate", String(fps),
      "-i", "-", // PNGs on stdin
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      // Force even dimensions (libx264 requirement) — these presets
      // are already even but it's cheap insurance.
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      outputPath,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );

  // Surface ffmpeg's stderr if encoding fails — easier debugging.
  const stderrChunks: Buffer[] = [];
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });

  const exit = new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 0));
  });

  try {
    for (let i = 0; i < totalFrames; i++) {
      const canvas = createCanvas(dims.width, dims.height);
      const progress = totalFrames <= 1 ? 1 : i / (totalFrames - 1);
      await paintBracketFrame({
        canvas,
        // Force the right canvas size preset for the chosen format —
        // the static card layout adapts automatically.
        input: { ...input.card, size: dims.size },
        progress,
      });
      const png = canvas.toBuffer("image/png");
      const ok = child.stdin?.write(png);
      if (ok === false) {
        // Wait for drain before queueing the next frame to avoid OOM.
        await new Promise<void>((resolve) => child.stdin?.once("drain", () => resolve()));
      }
    }
  } finally {
    child.stdin?.end();
  }

  const code = await exit;
  if (code !== 0) {
    const stderr = Buffer.concat(stderrChunks).toString("utf8");
    throw new Error(
      `ffmpeg exited with code ${code} while writing ${outputPath}: ${stderr.slice(0, 4000)}`,
    );
  }

  const stat = await fs.stat(outputPath);
  return {
    path: outputPath,
    sizeBytes: stat.size,
    durationSec,
    fps,
    frameCount: totalFrames,
    width: dims.width,
    height: dims.height,
  };
}
