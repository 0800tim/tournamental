/**
 * Caption template loader + renderer for auto-triggered clips.
 *
 * Templates live in `config/clip-captions.json` (repo root) keyed by event type
 * and clip format. Placeholders: {home}, {away}, {scorer}, {minute}, {score}.
 *
 * Hashtags are returned alongside the caption so the social-publisher can
 * append/format them per-platform without the caption itself growing
 * unwieldy.
 *
 * Captions never contain emojis - per the brand voice rule in
 * docs/15-vtourn-brand-and-positioning.md.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ClipFormat } from "./types.js";

/** Event type keys we render captions for. */
export type CaptionEventKey =
  | "event.goal"
  | "event.red_card"
  | "event.penalty"
  | "event.match_end";

export interface CaptionTemplate {
  caption: string;
  hashtags: string[];
}

export type CaptionConfig = {
  [K in CaptionEventKey]: { [F in ClipFormat]: CaptionTemplate };
};

export interface CaptionContext {
  home?: string;
  away?: string;
  scorer?: string;
  minute?: string;
  score?: string;
}

const PLACEHOLDER_RE = /\{(home|away|scorer|minute|score)\}/g;

/**
 * Resolve the on-disk path for the bundled caption-template file. We walk up
 * from the source dir to the repo root - works in both `tsx` (src/) and
 * compiled `dist/` layouts.
 */
function defaultCaptionPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/captions.ts -> ../../../config/clip-captions.json
  // dist/captions.js -> ../../../config/clip-captions.json
  const candidates = [
    resolve(here, "../../../config/clip-captions.json"),
    resolve(here, "../../../../config/clip-captions.json"),
    resolve(process.cwd(), "config/clip-captions.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Fall back to first candidate even if missing - caller will see the error.
  return candidates[0]!;
}

let cached: CaptionConfig | null = null;
let cachedPath: string | null = null;

/**
 * Load and validate the caption config. Caches by path - tests that pass a
 * different path get a fresh load.
 */
export function loadCaptionConfig(path?: string): CaptionConfig {
  const file = path ?? defaultCaptionPath();
  if (cached && cachedPath === file) return cached;
  const raw = readFileSync(file, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  validate(parsed);
  cached = parsed as unknown as CaptionConfig;
  cachedPath = file;
  return cached;
}

/** Reset the cache - test hook only. */
export function _resetCaptionCache(): void {
  cached = null;
  cachedPath = null;
}

function validate(parsed: Record<string, unknown>): void {
  const required: CaptionEventKey[] = [
    "event.goal",
    "event.red_card",
    "event.penalty",
    "event.match_end",
  ];
  const formats: ClipFormat[] = ["9:16", "1:1", "16:9"];
  for (const ev of required) {
    const block = parsed[ev];
    if (!block || typeof block !== "object") {
      throw new Error(`clip-captions: missing block for ${ev}`);
    }
    for (const fmt of formats) {
      const tpl = (block as Record<string, unknown>)[fmt];
      if (!tpl || typeof tpl !== "object") {
        throw new Error(`clip-captions: missing template ${ev}.${fmt}`);
      }
      const t = tpl as Record<string, unknown>;
      if (typeof t.caption !== "string" || t.caption.length === 0) {
        throw new Error(`clip-captions: ${ev}.${fmt}.caption must be a string`);
      }
      if (!Array.isArray(t.hashtags) || !t.hashtags.every((h) => typeof h === "string")) {
        throw new Error(`clip-captions: ${ev}.${fmt}.hashtags must be string[]`);
      }
      // Forbid emojis in caption + hashtags. Strip ASCII printable + common
      // whitespace; anything left is suspect.
      const all = [t.caption as string, ...(t.hashtags as string[])].join(" ");
      if (/[^\x09\x0A\x0D\x20-\x7E]/.test(all)) {
        throw new Error(
          `clip-captions: ${ev}.${fmt} contains non-ASCII chars (emojis are forbidden)`,
        );
      }
    }
  }
}

/**
 * Render a caption template by substituting placeholders. Missing context
 * values render as the literal placeholder name in square brackets (e.g.
 * `{scorer}` -> `[scorer]`) so the operator can spot a producer-side gap
 * without the caption looking broken.
 */
export function renderCaption(
  template: CaptionTemplate,
  ctx: CaptionContext,
): { caption: string; hashtags: string[] } {
  const caption = template.caption.replace(PLACEHOLDER_RE, (_match, key: string) => {
    const v = (ctx as Record<string, string | undefined>)[key];
    return v ?? `[${key}]`;
  });
  return { caption, hashtags: [...template.hashtags] };
}

export function getTemplate(
  config: CaptionConfig,
  eventKey: CaptionEventKey,
  format: ClipFormat,
): CaptionTemplate {
  return config[eventKey][format];
}
