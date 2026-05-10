/**
 * Flag rasterisation helpers for the canvas card renderer.
 *
 * Flags are stored as SVG in `apps/web/public/flags/<CODE>.svg`. We
 * convert each flag SVG → PNG bytes once (via `@resvg/resvg-js`) per
 * `<code>:<size>` key and cache the result. `@napi-rs/canvas`'s
 * `loadImage()` then ingests the PNG buffer for compositing.
 *
 * Missing-flag policy: if a code can't be resolved (file not on disk,
 * file unreadable), we synthesise a placeholder "monogram" flag — a
 * coloured square with the team code in white, kit-coloured if a kit
 * primary is supplied via `placeholderColour`. We never throw on a
 * missing flag — the share card must always render.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

import { Resvg } from "@resvg/resvg-js";

const flagPngCache = new Map<string, Uint8Array>();

/**
 * Default flags directory — resolved relative to this file's path so
 * the package works without knowing about the monorepo layout.
 *
 * Resolution order:
 *   1. explicit `flagsDir` arg (preferred — tests + prod pass this).
 *   2. `apps/web/public/flags` walked up from this file.
 */
export function defaultFlagsDir(): string {
  // packages/social-cards/src/canvas/flags.ts → up 4 levels = repo root.
  const here = new URL(import.meta.url).pathname;
  const repoRoot = here.replace(/\/packages\/.*$/, "");
  return join(repoRoot, "apps", "web", "public", "flags");
}

/**
 * Read and rasterise the SVG flag for a country code at the given pixel
 * width. Falls back to a placeholder if the SVG is missing or fails to
 * parse.
 */
export async function loadFlagPng(args: {
  code: string;
  width: number;
  flagsDir?: string;
  /** Used by the placeholder when the SVG is missing. */
  placeholderColour?: string;
}): Promise<Uint8Array> {
  const { code, width, flagsDir, placeholderColour } = args;
  const dir = flagsDir ?? defaultFlagsDir();
  const cacheKey = `${dir}::${code}::${Math.round(width)}`;
  const hit = flagPngCache.get(cacheKey);
  if (hit) return hit;

  const file = join(dir, `${code.toUpperCase()}.svg`);
  let svg: string | null = null;
  try {
    svg = await fs.readFile(file, "utf8");
  } catch {
    svg = null;
  }

  let png: Uint8Array;
  if (svg) {
    try {
      const r = new Resvg(svg, {
        fitTo: { mode: "width", value: Math.max(8, Math.round(width)) },
        background: "rgba(0,0,0,0)",
        font: { loadSystemFonts: false },
      });
      png = new Uint8Array(r.render().asPng());
    } catch {
      png = renderPlaceholderFlag({ code, width, colour: placeholderColour });
    }
  } else {
    png = renderPlaceholderFlag({ code, width, colour: placeholderColour });
  }

  flagPngCache.set(cacheKey, png);
  return png;
}

/**
 * Generate a placeholder "flag" as an SVG when the canonical asset
 * isn't on disk. The placeholder is the team's 3-letter code in white
 * on a coloured background — kit-coloured if known, slate otherwise.
 */
export function renderPlaceholderFlag(args: {
  code: string;
  width: number;
  colour?: string;
}): Uint8Array {
  const { code, width, colour } = args;
  const w = Math.max(8, Math.round(width));
  const h = Math.round(w * (2 / 3)); // 3:2 ratio matches the real flags
  const bg = colour ?? "#3e4a72";
  const safe = (code || "?").slice(0, 3).toUpperCase();
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${bg}"/>
  <text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="central"
    font-family="DejaVu Sans, Helvetica, Arial, sans-serif"
    font-weight="900" font-size="${Math.round(h * 0.45)}"
    fill="#ffffff">${escapeXml(safe)}</text>
</svg>`;
  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: w },
    background: "rgba(0,0,0,0)",
    font: { loadSystemFonts: false },
  });
  return new Uint8Array(r.render().asPng());
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Test-only: clear the in-process flag cache. */
export function _resetFlagCache(): void {
  flagPngCache.clear();
}
