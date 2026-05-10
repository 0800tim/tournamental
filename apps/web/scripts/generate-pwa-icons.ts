/**
 * Generate the PWA icon set from a single SVG mark.
 *
 * Emits to apps/web/public/icons/:
 *   - icon-192.png, icon-256.png, icon-384.png, icon-512.png  (any-purpose)
 *   - icon-maskable-192.png, icon-maskable-512.png            (maskable)
 *
 * The maskable variant uses a larger safe-zone (the V mark sits inside a
 * 60% inscribed circle so Android's adaptive-icon mask doesn't crop the
 * brand mark) per https://web.dev/maskable-icon/.
 *
 * Run with:
 *   pnpm --filter @vtorn/web exec tsx scripts/generate-pwa-icons.ts
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "..", "public", "icons");

const ACCENT = "#6cabdd";
const ACCENT_DARK = "#1f4f80";
const FG = "#0a0e1a";

function squareMark(size: number, opts: { maskable?: boolean }): string {
  const padding = opts.maskable ? size * 0.2 : size * 0.06;
  const inner = size - padding * 2;
  // Background gradient for character (Tim's brand: sky-blue + flame
  // accents). The V is solid ink-grey on top.
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${ACCENT}" />
      <stop offset="100%" stop-color="${ACCENT_DARK}" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${size}" height="${size}" fill="url(#bg)"
        rx="${opts.maskable ? 0 : size * 0.18}" />
  <g transform="translate(${padding} ${padding})">
    <path d="M ${inner * 0.18} ${inner * 0.22}
             L ${inner * 0.5}  ${inner * 0.78}
             L ${inner * 0.82} ${inner * 0.22}
             L ${inner * 0.7}  ${inner * 0.22}
             L ${inner * 0.5}  ${inner * 0.6}
             L ${inner * 0.3}  ${inner * 0.22}
             Z"
          fill="${FG}"
          stroke="${FG}"
          stroke-width="${inner * 0.01}" />
  </g>
</svg>`;
}

function render(size: number, opts: { maskable?: boolean }, outPath: string) {
  const svg = squareMark(size, opts);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
  });
  const png = resvg.render().asPng();
  writeFileSync(outPath, png);
}

function ensureDir(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

ensureDir(OUT_DIR);

const standardSizes = [192, 256, 384, 512];
for (const size of standardSizes) {
  const out = join(OUT_DIR, `icon-${size}.png`);
  render(size, { maskable: false }, out);
  console.log(`wrote ${out}`);
}
for (const size of [192, 512]) {
  const out = join(OUT_DIR, `icon-maskable-${size}.png`);
  render(size, { maskable: true }, out);
  console.log(`wrote ${out}`);
}
