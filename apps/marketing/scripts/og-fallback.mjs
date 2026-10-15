/**
 * Fallback OG card renderer (2026-10-16).
 *
 * build-og-cards.mjs renders through @tournamental/social-cards, which
 * is TypeScript source and cannot be imported by plain node during the
 * marketing build. Until that is fixed, every page's og:image pointed
 * at a missing PNG. This renderer draws a simple editorial card with
 * @resvg/resvg-js (same renderer the play app uses for its OG routes)
 * so social previews work. Brand-neutral: charcoal canvas, gold
 * eyebrow, Fraunces headline, wordmark footer.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = resolve(here, "..", "..", "web", "public", "fonts");
const FONT_FILES = ["Fraunces-700.ttf", "Fraunces-500.ttf", "Fraunces-500-Italic.ttf"]
  .map((f) => resolve(FONT_DIR, f))
  .filter((p) => existsSync(p));

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Greedy word wrap for a headline at a given approximate chars/line. */
function wrap(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

export function cardSvg({ eyebrow, headline, footer = "tournamental.com", art = null }) {
  const lines = wrap(headline, 30);
  const size = lines.length > 2 ? 60 : 72;
  const lineH = Math.round(size * 1.08);
  const startY = 300 - Math.round(((lines.length - 1) * lineH) / 2);
  const tspans = lines
    .map((l, i) => `<tspan x="72" y="${startY + i * lineH}">${esc(l)}</tspan>`)
    .join("");
  const artLayer = art
    ? `<g clip-path="url(#c)" opacity="0.55"><g transform="translate(360 -60) scale(0.9)">${art}</g></g>
       <rect width="1200" height="630" fill="url(#shade)"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <clipPath id="c"><rect width="1200" height="630"/></clipPath>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#15151a"/><stop offset="1" stop-color="#1c1c22"/></linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#15151a" stop-opacity="0.96"/><stop offset="0.6" stop-color="#15151a" stop-opacity="0.7"/><stop offset="1" stop-color="#15151a" stop-opacity="0.1"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  ${artLayer}
  <rect x="72" y="118" width="64" height="3" fill="#dca94b"/>
  <text x="72" y="100" font-family="Fraunces" font-size="22" font-weight="600" letter-spacing="5" fill="#dca94b">${esc(eyebrow.toUpperCase())}</text>
  <text font-family="Fraunces" font-size="${size}" font-weight="700" letter-spacing="-1" fill="#f7f3e8">${tspans}</text>
  <circle cx="86" cy="548" r="14" fill="#dca94b"/>
  <text x="112" y="557" font-family="Fraunces" font-size="26" font-weight="600" fill="#f7f3e8">Tournamental</text>
  <text x="1128" y="557" font-family="Fraunces" font-size="20" fill="#8d97a8" text-anchor="end">${esc(footer)}</text>
</svg>`;
}

export async function renderCardPng(svg) {
  const { Resvg } = await import("@resvg/resvg-js");
  const r = new Resvg(svg, {
    font: { fontFiles: FONT_FILES, loadSystemFonts: FONT_FILES.length === 0, defaultFontFamily: "Fraunces" },
  });
  return r.render().asPng();
}

export function heroArtInner() {
  const p = resolve(here, "..", "public", "rwc2027", "hero.svg");
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8").replace(/<svg[^>]*>/, "").replace("</svg>", "");
}
