/**
 * ffmpeg invocation. Deliberately lightweight: no fluent-ffmpeg dep, just
 * `child_process.spawn` driven through a small interface so tests can inject
 * a fake without ever launching a real encoder.
 *
 * Brand colours used by the drawtext overlay are sourced from
 * docs/15-tournamental-brand-and-positioning.md (Tournament Bot palette). Keep
 * these in sync if the brand shifts.
 */

import { spawn } from "node:child_process";

import type { ClipFormat, ClipOverlay } from "./types.js";

/** WC2026 brand colours used by the lower-third overlay. */
export const BRAND = {
  bg: "0x0B1220",
  text: "white",
  accent: "0xF8B500",
} as const;

export interface FfmpegArgs {
  inputPath: string;
  outputPath: string;
  start_ms: number;
  end_ms: number;
  format: ClipFormat;
  overlay?: ClipOverlay;
}

/**
 * Build the ffmpeg argv. Pure function — tested directly so we don't need to
 * spawn anything. Real spawn happens in `defaultFfmpegRunner` below.
 */
export function buildFfmpegArgs(bin: string, args: FfmpegArgs): string[] {
  const { width, height } = sizeFor(args.format);
  const durationS = Math.max(0, (args.end_ms - args.start_ms) / 1000);
  const startS = args.start_ms / 1000;

  const filters: string[] = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${BRAND.bg}`,
  ];

  const overlayLines = drawtextLines(args.overlay);
  filters.push(...overlayLines);

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    startS.toFixed(3),
    "-i",
    args.inputPath,
    "-t",
    durationS.toFixed(3),
    "-vf",
    filters.join(","),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    args.outputPath,
  ];
}

function sizeFor(format: ClipFormat): { width: number; height: number } {
  switch (format) {
    case "9:16":
      return { width: 1080, height: 1920 };
    case "1:1":
      return { width: 1080, height: 1080 };
    case "16:9":
      return { width: 1920, height: 1080 };
  }
}

/**
 * Convert overlay metadata into ffmpeg `drawtext` filter strings. Each line
 * is its own filter so we can stack them at separate vertical positions.
 *
 * Single quotes inside text are escaped per ffmpeg drawtext rules (see
 * https://ffmpeg.org/ffmpeg-filters.html#drawtext-1). We keep it simple:
 * strip characters that would break the filter syntax.
 */
function drawtextLines(overlay: ClipOverlay | undefined): string[] {
  if (!overlay) return [];
  const lines: string[] = [];
  // Background banner box at the bottom 12% of the frame.
  if (overlay.scoreline) {
    lines.push(
      drawtext({
        text: overlay.scoreline,
        fontsize: 56,
        y: "h-th-80",
        boxcolor: `${BRAND.bg}@0.85`,
      }),
    );
  }
  if (overlay.scorer) {
    lines.push(
      drawtext({
        text: overlay.scorer.toUpperCase(),
        fontsize: 40,
        y: "h-th-160",
        fontcolor: BRAND.accent,
      }),
    );
  }
  if (overlay.minute) {
    lines.push(
      drawtext({
        text: overlay.minute,
        fontsize: 32,
        y: "60",
        x: "w-tw-40",
      }),
    );
  }
  return lines;
}

interface DrawtextOpts {
  text: string;
  fontsize: number;
  x?: string;
  y: string;
  fontcolor?: string;
  boxcolor?: string;
}

function drawtext(opts: DrawtextOpts): string {
  const safe = sanitizeText(opts.text);
  const parts: string[] = [
    `text='${safe}'`,
    `fontsize=${opts.fontsize}`,
    `fontcolor=${opts.fontcolor ?? BRAND.text}`,
    `x=${opts.x ?? "(w-tw)/2"}`,
    `y=${opts.y}`,
    `borderw=2`,
    `bordercolor=black@0.6`,
  ];
  if (opts.boxcolor) {
    parts.push("box=1", `boxcolor=${opts.boxcolor}`, "boxborderw=12");
  }
  return `drawtext=${parts.join(":")}`;
}

/**
 * Strip characters that would break drawtext filter parsing. Keep only
 * printable ASCII + common punctuation; escape single quotes.
 */
export function sanitizeText(text: string): string {
  return text
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[\\:'%]/g, "")
    .trim();
}

// ---------- runner interface ----------

export interface FfmpegRunner {
  run(args: FfmpegArgs): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Optional: report whether the binary is reachable. */
  available(): Promise<boolean>;
}

export interface DefaultRunnerOptions {
  bin: string;
}

export function defaultFfmpegRunner(opts: DefaultRunnerOptions): FfmpegRunner {
  return {
    async available() {
      return new Promise<boolean>((resolve) => {
        try {
          const child = spawn(opts.bin, ["-version"], { stdio: "ignore" });
          child.once("error", () => resolve(false));
          child.once("exit", (code) => resolve(code === 0));
        } catch {
          resolve(false);
        }
      });
    },

    async run(args) {
      return new Promise((resolve) => {
        const argv = buildFfmpegArgs(opts.bin, args);
        let stderr = "";
        const child = spawn(opts.bin, argv, { stdio: ["ignore", "ignore", "pipe"] });
        child.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
          if (stderr.length > 64_000) stderr = stderr.slice(-64_000);
        });
        child.once("error", (err) => resolve({ ok: false, error: err.message }));
        child.once("exit", (code) => {
          if (code === 0) resolve({ ok: true });
          else resolve({ ok: false, error: `ffmpeg exited with code ${code}: ${stderr.trim()}` });
        });
      });
    },
  };
}
