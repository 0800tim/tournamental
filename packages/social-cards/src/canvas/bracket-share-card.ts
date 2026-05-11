/**
 * Canvas-rendered bracket share card (v2 — pyramid + flags-in-cups + QR).
 *
 * v1 (PR #144) was a header + "PATH TO GOLD" stage strip + gold/silver/
 * bronze podium with flag chips *under* the cups.
 *
 * v2 (Tim feedback 2026-05-11) replaces the stage strip with a
 * stylised 2D pyramid silhouette that mirrors the 3D molecule v4 — the
 * champion's flag rises through all seven layers (group → r32 → r16 →
 * qf → sf → final → champion) with a gold trail connecting the
 * instances. Other (non-path) teams sit at their elimination tier as
 * dim flag discs to give the pyramid a visual silhouette. Flags now
 * also live *inside* the cup bowls (clipped to the bowl ellipse with a
 * medal-tint overlay) instead of as a chip beneath. The footer renders
 * the share-guid deep-link URL `play.tournamental.com/s/<guid>` with a
 * gold-on-navy QR code.
 *
 * Layout (landscape — 1200×630):
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ [V] Tournamental         FIFA WC 2026 — MY BRACKET           │ header
 *   │                                                      @handle │
 *   ├──────────────────────────┬───────────────────────────────────┤
 *   │      PYRAMID             │              MY PODIUM             │
 *   │                          │                                    │
 *   │           🏆 ARG         │           🥇                       │
 *   │          ARG ARG         │       (flag-inside-cup)            │
 *   │         ·  ARG  ·        │                                    │
 *   │       ·   ARG    ·       │      🥈           🥉              │
 *   │     ·    ARG       ·     │                                    │
 *   │   ·  ·   ARG  ·  ·  ·    │   FRA              BRA             │
 *   │ · · · · ARG · · · · · ·  │                                    │
 *   │  (base ring greyed)      │                                    │
 *   ├──────────────────────────┴───────────────────────────────────┤
 *   │ Predict yours at play.tournamental.com/s/<guid>   [QR]  Tournamental
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Portrait (1080×1350) and Square (1080×1080) variants compress the
 * left/right split (see `layoutGeometry`).
 *
 * Output: a PNG `Buffer`.
 */

import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import type { SKRSContext2D, Canvas, Image } from "@napi-rs/canvas";
import * as QRCode from "qrcode";

import {
  CANVAS_SIZES,
  PYRAMID_LAYERS,
  STAGE_TO_LAYER,
  type BracketShareCardInput,
  type BracketShareChampion,
  type BracketShareEliminationTier,
  type CanvasCardSize,
  type PyramidLayer,
} from "./types.js";
import { loadFlagImage } from "./flags.js";

const ACCENT_DEFAULT = "#7eb6e8";
const BG_DARK = "#0a0e1a";
const BG_DARK_2 = "#101626";
const INK_200 = "#cdd5e7";
const INK_400 = "#7a8aab";
const GOLD = "#f5c542";
const GOLD_WARM = "#fbbf24";
const GOLD_DEEP = "#b8862a";
const SILVER = "#d8dde6";
const SILVER_DEEP = "#8c93a3";
const BRONZE = "#d8954f";
const BRONZE_DEEP = "#854a1d";
const WHITE = "#ffffff";

const BRAND_WORDMARK = "Tournamental";
const SHARE_BASE_URL = "play.tournamental.com/s/";

let fontsRegistered = false;

function ensureFonts(): void {
  if (fontsRegistered) return;
  fontsRegistered = true;
  const candidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ];
  for (const path of candidates) {
    try {
      GlobalFonts.registerFromPath(path, "DejaVu Sans");
    } catch {
      // system fallback is fine
    }
  }
}

export async function renderBracketShareCard(input: BracketShareCardInput): Promise<Buffer> {
  ensureFonts();
  const size: CanvasCardSize = input.size ?? "portrait";
  const dim = CANVAS_SIZES[size];
  const canvas = createCanvas(dim.width, dim.height);
  const ctx = canvas.getContext("2d");

  paintBackground(ctx, dim.width, dim.height, input.champion.kit?.primary ?? null);
  await paintLayout(ctx, dim.width, dim.height, size, input);

  return canvas.toBuffer("image/png");
}

export async function paintBracketFrame(args: {
  canvas: Canvas;
  input: BracketShareCardInput;
  /** Stage in the 6-second reveal, 0..1. */
  progress: number;
}): Promise<void> {
  ensureFonts();
  const { canvas, input, progress } = args;
  const w = canvas.width;
  const h = canvas.height;
  const size: CanvasCardSize =
    input.size ?? (h >= w ? "portrait" : "landscape");
  const ctx = canvas.getContext("2d");

  paintBackground(ctx, w, h, input.champion.kit?.primary ?? null);
  await paintLayout(ctx, w, h, size, input, { progress });
}

// ---------- internals ----------

function paintBackground(
  ctx: SKRSContext2D,
  w: number,
  h: number,
  kitPrimaryRaw: string | null | undefined,
): void {
  ctx.fillStyle = BG_DARK;
  ctx.fillRect(0, 0, w, h);

  const accent = sanitiseHex(kitPrimaryRaw) ?? ACCENT_DEFAULT;
  // Two-pole gradient: kit-tint right (where the podium sits) so the
  // gold cup feels lifted out of the surrounding glow.
  const cx = w * 0.72;
  const cy = h * 0.45;
  const radius = Math.max(w, h) * 0.85;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g.addColorStop(0, hexToRgba(accent, 0.42));
  g.addColorStop(0.45, hexToRgba(accent, 0.18));
  g.addColorStop(1, hexToRgba(BG_DARK, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Slight footer fade so the URL row stays legible.
  const fade = ctx.createLinearGradient(0, h * 0.6, 0, h);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, hexToRgba(BG_DARK, 0.55));
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
}

interface LayoutOpts {
  progress?: number;
}

async function paintLayout(
  ctx: SKRSContext2D,
  w: number,
  h: number,
  size: CanvasCardSize,
  input: BracketShareCardInput,
  opts: LayoutOpts = {},
): Promise<void> {
  const progress = clamp01(opts.progress ?? 1);
  const accent = sanitiseHex(input.champion.kit?.primary) ?? ACCENT_DEFAULT;
  const geom = layoutGeometry(size, w, h);

  await paintHeader(ctx, geom, input, accent, progress);
  await paintPyramid(ctx, geom, input, accent, progress);
  await paintPodium(ctx, geom, input, accent, progress);
  await paintFooter(ctx, geom, input, accent, progress);
}

interface Geom {
  size: CanvasCardSize;
  w: number;
  h: number;
  padX: number;
  // Header
  headerY: number;
  headerHeight: number;
  // Two-column body
  leftX: number;
  leftWidth: number;
  rightX: number;
  rightWidth: number;
  bodyTop: number;
  bodyBottom: number;
  // Footer
  footerY: number;
  footerHeight: number;
  // Typography
  titleFont: number;
  handleFont: number;
  sectionLabelFont: number;
  podiumLabelFont: number;
  podiumTeamFont: number;
  podiumNameFont: number;
  footerFont: number;
  wordmarkFont: number;
  // QR
  qrSize: number;
}

function layoutGeometry(size: CanvasCardSize, w: number, h: number): Geom {
  if (size === "landscape") {
    // 1200 x 630 — header + body + footer.
    // LEFT 45% — pyramid; RIGHT 55% — podium cups.
    return {
      size, w, h,
      padX: 48,
      headerY: 28,
      headerHeight: 58,
      leftX: 48,
      leftWidth: w * 0.45 - 48,
      rightX: w * 0.46,
      rightWidth: w - w * 0.46 - 48,
      bodyTop: 110,
      bodyBottom: h - 76,
      footerY: h - 62,
      footerHeight: 50,
      titleFont: 24,
      handleFont: 18,
      sectionLabelFont: 18,
      podiumLabelFont: 16,
      podiumTeamFont: 18,
      podiumNameFont: 28,
      footerFont: 18,
      wordmarkFont: 14,
      qrSize: 50,
    };
  }
  if (size === "square") {
    // 1080 x 1080 — compress vertically: pyramid takes top 60%,
    // cups bottom 40% of the body area (per the v2 spec).
    return {
      size, w, h,
      padX: 56,
      headerY: 44,
      headerHeight: 80,
      leftX: 56,
      // Square mode is stacked, so leftWidth = full body width.
      leftWidth: w - 112,
      rightX: 56,
      rightWidth: w - 112,
      bodyTop: 160,
      bodyBottom: h - 110,
      footerY: h - 88,
      footerHeight: 60,
      titleFont: 28,
      handleFont: 22,
      sectionLabelFont: 22,
      podiumLabelFont: 20,
      podiumTeamFont: 24,
      podiumNameFont: 40,
      footerFont: 22,
      wordmarkFont: 18,
      qrSize: 64,
    };
  }
  // portrait (default — 1080 × 1350) — stacked: pyramid on top half,
  // cups on bottom half.
  return {
    size, w, h,
    padX: 60,
    headerY: 52,
    headerHeight: 88,
    leftX: 60,
    leftWidth: w - 120,
    rightX: 60,
    rightWidth: w - 120,
    bodyTop: 200,
    bodyBottom: h - 140,
    footerY: h - 110,
    footerHeight: 70,
    titleFont: 32,
    handleFont: 24,
    sectionLabelFont: 24,
    podiumLabelFont: 22,
    podiumTeamFont: 28,
    podiumNameFont: 56,
    footerFont: 24,
    wordmarkFont: 20,
    qrSize: 72,
  };
}

// ---------- header ----------

async function paintHeader(
  ctx: SKRSContext2D,
  geom: Geom,
  input: BracketShareCardInput,
  accent: string,
  progress: number,
): Promise<void> {
  const alpha = easeIn(progress, 0.0, 0.25);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  // T-mark + Tournamental wordmark on the left.
  const markSize = Math.round(geom.headerHeight * 0.62);
  const markX = geom.padX;
  const markY = geom.headerY;
  ctx.fillStyle = accent;
  roundRect(ctx, markX, markY, markSize, markSize, 8);
  ctx.fill();
  ctx.fillStyle = BG_DARK;
  ctx.font = `900 ${Math.round(markSize * 0.7)}px "DejaVu Sans", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("T", markX + markSize / 2, markY + markSize / 2 + 2);

  ctx.fillStyle = WHITE;
  ctx.font = `900 ${geom.titleFont}px "DejaVu Sans", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(BRAND_WORDMARK, markX + markSize + 14, markY + markSize / 2 + 2);

  // Tournament name + handle on the right.
  const title = `${input.tournamentName} — MY BRACKET`;
  const handle = `@${input.user.handle}`;
  const yMid = markY + markSize / 2;
  ctx.fillStyle = INK_200;
  ctx.font = `700 ${geom.handleFont}px "DejaVu Sans", sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(title, geom.w - geom.padX, yMid - 14);
  ctx.fillStyle = WHITE;
  ctx.fillText(handle, geom.w - geom.padX, yMid + 14);

  ctx.restore();
}

// ---------- pyramid silhouette ----------

interface PyramidRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pick the pyramid region inside the geometry, dependent on size. */
function pyramidRegion(geom: Geom): PyramidRegion {
  if (geom.size === "portrait") {
    // Top 55% of body
    const bodyH = geom.bodyBottom - geom.bodyTop;
    return {
      x: geom.leftX,
      y: geom.bodyTop,
      width: geom.leftWidth,
      height: Math.round(bodyH * 0.55),
    };
  }
  if (geom.size === "square") {
    const bodyH = geom.bodyBottom - geom.bodyTop;
    return {
      x: geom.leftX,
      y: geom.bodyTop,
      width: geom.leftWidth,
      height: Math.round(bodyH * 0.6),
    };
  }
  // landscape — left column, full body height.
  return {
    x: geom.leftX,
    y: geom.bodyTop,
    width: geom.leftWidth,
    height: geom.bodyBottom - geom.bodyTop,
  };
}

/** Y position for a pyramid layer, top-anchored (Y0=top, Y=region.bottom at base). */
function layerY(region: PyramidRegion, layer: PyramidLayer): number {
  // PYRAMID_LAYERS goes group..champion (base..apex). Map evenly into
  // the region so each layer gets a consistent vertical step.
  const idx = PYRAMID_LAYERS.indexOf(layer);
  const layerCount = PYRAMID_LAYERS.length; // 7
  // group sits ~12% from the bottom (leave room for the base scatter),
  // champion sits ~5% from the top. Linear in-between.
  const tBottom = 0.12;
  const tTop = 0.05;
  const ratio = idx / (layerCount - 1);
  const t = tBottom - ratio * (tBottom - tTop); // 0.12 down to 0.05
  // Higher idx (closer to apex) = smaller distance from top.
  const yFromTopFrac = 1 - t - ratio * (1 - t - tTop);
  return region.y + yFromTopFrac * region.height;
}

/** Atom diameter for a given layer — biggest at apex, smallest at base. */
function atomDiameter(region: PyramidRegion, layer: PyramidLayer): number {
  // group(min) … champion(max). Scale against region width so the
  // pyramid stays balanced at all three card sizes.
  const sizeMap: Record<PyramidLayer, number> = {
    group: 0.045,
    r32: 0.055,
    r16: 0.065,
    qf: 0.075,
    sf: 0.085,
    final: 0.095,
    champion: 0.11,
  };
  const minDim = Math.min(region.width, region.height);
  // Floor/ceil so the smallest is ~16px and biggest ~36px on landscape.
  return Math.max(14, Math.round(minDim * sizeMap[layer]));
}

async function paintPyramid(
  ctx: SKRSContext2D,
  geom: Geom,
  input: BracketShareCardInput,
  accent: string,
  progress: number,
): Promise<void> {
  const alpha = easeIn(progress, 0.25, 0.7);
  if (alpha <= 0) return;

  const region = pyramidRegion(geom);
  const cx = region.x + region.width / 2;
  const champCode = input.champion.code;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Section label.
  ctx.fillStyle = GOLD;
  ctx.font = `900 ${geom.sectionLabelFont}px "DejaVu Sans", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("PYRAMID", region.x, region.y - geom.sectionLabelFont - 4);

  // Subtle pyramid outline triangle so the silhouette reads even when
  // the context atoms are sparse / missing.
  drawPyramidGuide(ctx, region);

  // 1) Scatter base-ring + lower-tier context atoms (dim) so the
  //    pyramid has body. These are drawn FIRST so the champion
  //    column sits in front.
  if (input.allEliminatedByStage && input.allEliminatedByStage.length > 0) {
    await drawContextAtoms(
      ctx,
      region,
      input.allEliminatedByStage,
      champCode,
      input.flagsDir,
    );
  }

  // 2) Draw the champion's path column — every layer from group up to
  //    champion, with a gold trail connecting them and a glow halo.
  await drawChampionColumn(
    ctx,
    region,
    cx,
    input.champion,
    accent,
    input.flagsDir,
  );

  ctx.restore();
}

function drawPyramidGuide(ctx: SKRSContext2D, region: PyramidRegion): void {
  // Faint isometric triangle outline.
  const cx = region.x + region.width / 2;
  const apexY = layerY(region, "champion") - 18;
  const baseY = layerY(region, "group") + 24;
  const baseHalf = region.width * 0.42;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, apexY);
  ctx.lineTo(cx + baseHalf, baseY);
  ctx.lineTo(cx - baseHalf, baseY);
  ctx.closePath();
  ctx.stroke();

  // A few interior "tier" lines, very faint.
  for (const layer of PYRAMID_LAYERS) {
    if (layer === "champion" || layer === "group") continue;
    const y = layerY(region, layer);
    const t = (baseY - y) / (baseY - apexY); // 0..1 apex..base
    const halfW = baseHalf * (1 - t);
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - halfW, y);
    ctx.lineTo(cx + halfW, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Draw the champion column with gold trail + glow halo. */
async function drawChampionColumn(
  ctx: SKRSContext2D,
  region: PyramidRegion,
  cx: number,
  champion: BracketShareChampion,
  accent: string,
  flagsDir: string | undefined,
): Promise<void> {
  if (!champion.code) return;

  // Walk layers bottom → top, recording the centre of each atom.
  const points: Array<{ x: number; y: number; d: number; layer: PyramidLayer }> = [];
  for (const layer of PYRAMID_LAYERS) {
    const y = layerY(region, layer);
    const d = atomDiameter(region, layer);
    points.push({ x: cx, y, d, layer });
  }

  // 1) Gold trail behind the atoms — a thick, glow-shadowed line
  //    threaded through the centres with a slight Bezier S-curve.
  ctx.save();
  ctx.shadowColor = hexToRgba(GOLD_WARM, 0.55);
  ctx.shadowBlur = 14;
  ctx.strokeStyle = GOLD_WARM;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (i === 0) {
      ctx.moveTo(p.x, p.y);
    } else {
      const prev = points[i - 1]!;
      const midY = (prev.y + p.y) / 2;
      // Slight sinusoidal x sway so the trail isn't a dead-straight line.
      const sway = ((i % 2 === 0) ? 1 : -1) * Math.min(8, region.width * 0.015);
      ctx.bezierCurveTo(prev.x + sway, midY, p.x - sway, midY, p.x, p.y);
    }
  }
  ctx.stroke();
  ctx.restore();

  // 2) Atoms on top of the trail. Apex = biggest, base = smallest.
  for (const p of points) {
    await drawFlagDisc(ctx, {
      cx: p.x,
      cy: p.y,
      diameter: p.d,
      teamCode: champion.code,
      flagsDir,
      onPath: true,
      accent,
    });
  }

  // 3) Big champion label above the apex atom — short and gold.
  const apex = points[points.length - 1]!;
  ctx.save();
  ctx.fillStyle = GOLD;
  ctx.font = `900 14px "DejaVu Sans", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.shadowColor = hexToRgba(GOLD_WARM, 0.65);
  ctx.shadowBlur = 8;
  ctx.fillText(champion.code.toUpperCase(), apex.x, apex.y - apex.d / 2 - 6);
  ctx.restore();
}

/** Scatter the (non-path) elimination-tier flag discs. */
async function drawContextAtoms(
  ctx: SKRSContext2D,
  region: PyramidRegion,
  tiers: ReadonlyArray<BracketShareEliminationTier>,
  champCode: string,
  flagsDir: string | undefined,
): Promise<void> {
  const champCodeUpper = champCode.toUpperCase();
  for (const tier of tiers) {
    const layer = tier.stage; // restricted to base/lower tiers in the type
    const codes = tier.teamCodes
      .map((c) => c.toUpperCase())
      .filter((c) => c && c !== champCodeUpper);
    if (codes.length === 0) continue;

    const y = layerY(region, layer);
    const halfW = pyramidHalfWidthAtLayer(region, layer);
    const d = Math.max(14, Math.round(atomDiameter(region, layer) * 0.85));

    // Evenly distribute along the available row. Pad ends so atoms don't
    // collide with the outline triangle.
    const usableHalf = halfW - d * 0.6;
    if (codes.length === 1) {
      // Single atom — push left of centre slightly.
      const x = (region.x + region.width / 2) - d * 0.8;
      await drawFlagDisc(ctx, {
        cx: x,
        cy: y,
        diameter: d,
        teamCode: codes[0]!,
        flagsDir,
        onPath: false,
      });
      continue;
    }
    for (let i = 0; i < codes.length; i++) {
      const t = i / (codes.length - 1); // 0..1
      const xOffset = -usableHalf + t * (usableHalf * 2);
      const x = region.x + region.width / 2 + xOffset;
      // Skip the centre slot to keep the champion column readable.
      if (Math.abs(xOffset) < d * 0.6) continue;
      await drawFlagDisc(ctx, {
        cx: x,
        cy: y,
        diameter: d,
        teamCode: codes[i]!,
        flagsDir,
        onPath: false,
      });
    }
  }
}

function pyramidHalfWidthAtLayer(region: PyramidRegion, layer: PyramidLayer): number {
  const apexY = layerY(region, "champion") - 18;
  const baseY = layerY(region, "group") + 24;
  const y = layerY(region, layer);
  const baseHalf = region.width * 0.42;
  const t = (baseY - y) / Math.max(1, baseY - apexY);
  return baseHalf * (1 - t);
}

interface FlagDiscArgs {
  cx: number;
  cy: number;
  diameter: number;
  teamCode: string;
  flagsDir?: string;
  onPath: boolean;
  accent?: string;
}

/**
 * Draw a circular flag disc. `onPath` atoms get a gold rim + slight
 * glow; off-path atoms are dimmed via a navy overlay.
 */
async function drawFlagDisc(ctx: SKRSContext2D, args: FlagDiscArgs): Promise<void> {
  const { cx, cy, diameter, teamCode, flagsDir, onPath } = args;
  const r = diameter / 2;
  ctx.save();
  // Clip to circle.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  // Flag fill inside circle.
  let img: Image | null = null;
  try {
    img = await loadFlagImage({
      code: teamCode,
      width: Math.max(24, diameter * 2),
      flagsDir,
    });
  } catch {
    // ignore — fallback handled below
  }
  if (img) {
    // Centre-crop the flag rectangle into the circle. Flag aspect 3:2.
    const flagH = diameter;
    const flagW = diameter * 1.5;
    ctx.drawImage(img, cx - flagW / 2, cy - flagH / 2, flagW, flagH);
  } else {
    ctx.fillStyle = "#3e4a72";
    ctx.fillRect(cx - r, cy - r, diameter, diameter);
    ctx.fillStyle = WHITE;
    ctx.font = `900 ${Math.round(diameter * 0.4)}px "DejaVu Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(teamCode.slice(0, 3).toUpperCase(), cx, cy + 1);
  }
  // Off-path dim overlay.
  if (!onPath) {
    ctx.fillStyle = hexToRgba(BG_DARK, 0.55);
    ctx.fillRect(cx - r, cy - r, diameter, diameter);
  }
  ctx.restore();

  // Rim — gold for on-path, faint navy for off-path.
  if (onPath) {
    ctx.save();
    ctx.shadowColor = hexToRgba(GOLD_WARM, 0.45);
    ctx.shadowBlur = 6;
    ctx.strokeStyle = GOLD_WARM;
    ctx.lineWidth = Math.max(1.5, diameter * 0.06);
    ctx.beginPath();
    ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.save();
    ctx.strokeStyle = "rgba(180,200,230,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ---------- podium (cups with flags-as-fill) ----------

interface PodiumRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

function podiumRegion(geom: Geom): PodiumRegion {
  if (geom.size === "portrait") {
    const bodyH = geom.bodyBottom - geom.bodyTop;
    const pyrH = Math.round(bodyH * 0.55);
    return {
      x: geom.rightX,
      y: geom.bodyTop + pyrH + 20,
      width: geom.rightWidth,
      height: bodyH - pyrH - 20,
    };
  }
  if (geom.size === "square") {
    const bodyH = geom.bodyBottom - geom.bodyTop;
    const pyrH = Math.round(bodyH * 0.6);
    return {
      x: geom.rightX,
      y: geom.bodyTop + pyrH + 12,
      width: geom.rightWidth,
      height: bodyH - pyrH - 12,
    };
  }
  return {
    x: geom.rightX,
    y: geom.bodyTop,
    width: geom.rightWidth,
    height: geom.bodyBottom - geom.bodyTop,
  };
}

async function paintPodium(
  ctx: SKRSContext2D,
  geom: Geom,
  input: BracketShareCardInput,
  accent: string,
  progress: number,
): Promise<void> {
  const alpha = easeIn(progress, 0.3, 0.75);
  if (alpha <= 0) return;

  // Derive silver/bronze if explicit fields aren't present.
  const silver: BracketShareChampion | null = input.runnerUp ?? null;
  const bronze: BracketShareChampion | null =
    input.thirdPlace ?? championFromPath(input.knockoutPath, "tp");

  const region = podiumRegion(geom);

  ctx.save();
  ctx.globalAlpha = alpha;

  // Section label.
  ctx.fillStyle = GOLD;
  ctx.font = `900 ${geom.sectionLabelFont}px "DejaVu Sans", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("MY PODIUM", region.x, region.y - geom.sectionLabelFont - 4);

  // Layout: gold cup centred + tallest; silver left; bronze right.
  const rightCx = region.x + region.width / 2;
  const podiumTop = region.y;
  const podiumHeight = region.height;

  const baseUnit = Math.min(region.width / 3.4, podiumHeight / 4.4);
  const goldCupW = Math.round(baseUnit * 1.45);
  const sideCupW = Math.round(baseUnit * 1.0);
  const cupGap = Math.round(baseUnit * 0.32);

  const goldBaseline = podiumTop + Math.round(podiumHeight * 0.55);
  const sideBaseline = goldBaseline + Math.round(baseUnit * 0.22);

  const goldCx = rightCx;
  const silverCx = goldCx - goldCupW / 2 - sideCupW / 2 - cupGap;
  const bronzeCx = goldCx + goldCupW / 2 + sideCupW / 2 + cupGap;

  await renderPodiumColumn(ctx, {
    centerX: silverCx,
    baseline: sideBaseline,
    cupWidth: sideCupW,
    rank: 2,
    label: "2ND",
    team: silver,
    fill: SILVER,
    shadow: SILVER_DEEP,
    medalTint: SILVER,
    podiumLabelFont: geom.podiumLabelFont,
    podiumTeamFont: geom.podiumTeamFont,
    flagsDir: input.flagsDir,
    progress,
    showFrom: 0.45,
    showTo: 0.7,
  });
  await renderPodiumColumn(ctx, {
    centerX: bronzeCx,
    baseline: sideBaseline,
    cupWidth: sideCupW,
    rank: 3,
    label: "3RD",
    team: bronze,
    fill: BRONZE,
    shadow: BRONZE_DEEP,
    medalTint: BRONZE,
    podiumLabelFont: geom.podiumLabelFont,
    podiumTeamFont: geom.podiumTeamFont,
    flagsDir: input.flagsDir,
    progress,
    showFrom: 0.5,
    showTo: 0.75,
  });
  await renderPodiumColumn(ctx, {
    centerX: goldCx,
    baseline: goldBaseline,
    cupWidth: goldCupW,
    rank: 1,
    label: "1ST",
    team: input.champion,
    fill: GOLD,
    shadow: GOLD_DEEP,
    medalTint: GOLD,
    podiumLabelFont: geom.podiumLabelFont,
    podiumTeamFont: geom.podiumTeamFont,
    flagsDir: input.flagsDir,
    progress,
    showFrom: 0.4,
    showTo: 0.7,
    glowAccent: accent,
  });

  // Champion country name below the gold cup.
  const nameAlpha = easeIn(progress, 0.6, 0.85);
  if (nameAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = alpha * nameAlpha;
    ctx.fillStyle = WHITE;
    ctx.font = `900 ${geom.podiumNameFont}px "DejaVu Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const champLineY = goldBaseline + Math.round(baseUnit * 1.05);
    ctx.fillText(
      input.champion.name.toUpperCase(),
      rightCx,
      champLineY,
    );
    const pillText = "MY CHAMPION";
    ctx.font = `900 ${geom.podiumLabelFont}px "DejaVu Sans", sans-serif`;
    const padPill = 14;
    const pillW = ctx.measureText(pillText).width + padPill * 2;
    const pillH = Math.round(geom.podiumLabelFont * 1.7);
    const pillX = rightCx - pillW / 2;
    const pillY = champLineY + geom.podiumNameFont + 10;
    ctx.fillStyle = GOLD;
    roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.fillStyle = BG_DARK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(pillText, rightCx, pillY + pillH / 2 + 1);
    ctx.restore();
  }

  ctx.restore();
}

interface PodiumColumnArgs {
  centerX: number;
  baseline: number;
  cupWidth: number;
  rank: 1 | 2 | 3;
  label: string;
  team: BracketShareChampion | null;
  fill: string;
  shadow: string;
  medalTint: string;
  podiumLabelFont: number;
  podiumTeamFont: number;
  flagsDir?: string;
  progress: number;
  showFrom: number;
  showTo: number;
  glowAccent?: string;
}

async function renderPodiumColumn(
  ctx: SKRSContext2D,
  args: PodiumColumnArgs,
): Promise<void> {
  const colAlpha = easeIn(args.progress, args.showFrom, args.showTo);
  if (colAlpha <= 0) return;

  const w = args.cupWidth;
  const cx = args.centerX;
  const baseY = args.baseline;
  const bowlW = w;
  const bowlH = w * 0.95;
  const stemH = w * 0.18;
  const baseW = w * 1.05;
  const baseH = w * 0.18;
  const handleW = w * 0.22;

  ctx.save();
  ctx.globalAlpha = colAlpha;

  // Glow halo for gold.
  if (args.glowAccent) {
    const glow = ctx.createRadialGradient(cx, baseY - bowlH * 0.5, 0, cx, baseY - bowlH * 0.5, w * 1.4);
    glow.addColorStop(0, hexToRgba(args.glowAccent, 0.45));
    glow.addColorStop(0.6, hexToRgba(args.glowAccent, 0.12));
    glow.addColorStop(1, hexToRgba(args.glowAccent, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, baseY - bowlH * 0.5, w * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Base plate.
  const baseTop = baseY - baseH;
  drawCupBase(ctx, cx - baseW / 2, baseTop, baseW, baseH, args.fill, args.shadow);

  // Stem.
  const stemW = w * 0.22;
  const stemTop = baseTop - stemH;
  ctx.fillStyle = args.shadow;
  ctx.fillRect(cx - stemW / 2, stemTop, stemW, stemH);
  ctx.fillStyle = args.fill;
  ctx.fillRect(cx - stemW / 2 + 2, stemTop, stemW - 4, stemH);

  // Handles.
  drawCupHandle(ctx, cx, stemTop, bowlW, bowlH, handleW, args.shadow, "left");
  drawCupHandle(ctx, cx, stemTop, bowlW, bowlH, handleW, args.shadow, "right");

  // Bowl + flag fill (v2: flag lives INSIDE the bowl ellipse).
  const bowlCx = cx;
  const bowlCy = stemTop - bowlH / 2;
  const bowlRx = bowlW / 2;
  const bowlRy = bowlH / 2;
  await drawCupBowlWithFlag(ctx, {
    cx: bowlCx,
    cy: bowlCy,
    rx: bowlRx,
    ry: bowlRy,
    team: args.team,
    flagsDir: args.flagsDir,
    rimFill: args.fill,
    rimShadow: args.shadow,
    medalTint: args.medalTint,
  });

  // Rank label on the bowl (overlaid on top of flag fill, in dark ink
  // with a soft halo so it stays legible against any flag colour).
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 5;
  ctx.fillStyle = WHITE;
  const labelFont = Math.round(bowlH * 0.3);
  ctx.font = `900 ${labelFont}px "DejaVu Sans", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(args.label, bowlCx, bowlCy + 2);
  ctx.restore();

  // Country code text beneath the base plate (the only text "below").
  const codeY = baseY + 12;
  if (args.team && args.team.code) {
    ctx.fillStyle = WHITE;
    ctx.font = `900 ${args.podiumTeamFont}px "DejaVu Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(args.team.code.toUpperCase(), cx, codeY);
  } else {
    ctx.fillStyle = INK_200;
    ctx.font = `900 ${args.podiumTeamFont}px "DejaVu Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("?", cx, codeY);
  }

  ctx.restore();
}

interface BowlWithFlagArgs {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  team: BracketShareChampion | null;
  flagsDir?: string;
  rimFill: string;
  rimShadow: string;
  medalTint: string;
}

/**
 * Draw the cup bowl as an ellipse, with the team flag clipped to the
 * ellipse and a 0.45-alpha medal tint overlay. Re-draws the metal rim
 * + a thin top accent on top so the cup still reads as gold/silver/
 * bronze regardless of the flag colours.
 */
async function drawCupBowlWithFlag(
  ctx: SKRSContext2D,
  args: BowlWithFlagArgs,
): Promise<void> {
  const { cx, cy, rx, ry, team, flagsDir, rimFill, rimShadow, medalTint } = args;

  // 1) Outer rim/shadow ellipse — slightly larger so the inside fill
  //    can shrink and the rim shows.
  ctx.save();
  ctx.fillStyle = rimShadow;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 2, rx + 3, ry + 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 2) Clip to bowl ellipse, draw flag (if any), then medal tint.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();

  // Base wash — medal colour so missing-flag still looks like a cup.
  ctx.fillStyle = rimFill;
  ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);

  if (team && team.code) {
    try {
      const img = await loadFlagImage({
        code: team.code,
        width: Math.max(64, Math.round(rx * 2 * 1.2)),
        flagsDir,
      });
      // Stretch flag to fully cover the bowl ellipse's bounding box.
      ctx.drawImage(img, cx - rx, cy - ry, rx * 2, ry * 2);
    } catch {
      // wash already drawn — fall through
    }
  }

  // Medal-tint overlay (gold/silver/bronze at 0.45 alpha) so the cup
  // still reads "gold" / "silver" / "bronze" at a glance.
  ctx.fillStyle = hexToRgba(medalTint, 0.45);
  ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);

  ctx.restore();

  // 3) Top accent (rim highlight).
  ctx.save();
  ctx.strokeStyle = rimFill;
  ctx.lineWidth = Math.max(2, ry * 0.08);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Thin inner highlight to give the bowl depth.
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(cx, cy - ry * 0.18, rx * 0.82, ry * 0.55, 0, Math.PI * 0.9, Math.PI * 0.1, true);
  ctx.stroke();
  ctx.restore();
}

function drawCupBase(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  shadow: string,
): void {
  ctx.fillStyle = shadow;
  roundRect(ctx, x, y, w, h, h * 0.35);
  ctx.fill();
  ctx.fillStyle = fill;
  roundRect(ctx, x + 2, y + 2, w - 4, h - 6, h * 0.3);
  ctx.fill();
}

function drawCupHandle(
  ctx: SKRSContext2D,
  cx: number,
  stemTop: number,
  bowlW: number,
  bowlH: number,
  handleW: number,
  shadow: string,
  side: "left" | "right",
): void {
  const dir = side === "left" ? -1 : 1;
  const baseX = cx + dir * (bowlW / 2);
  const topY = stemTop - bowlH * 0.85;
  const bottomY = stemTop - bowlH * 0.25;
  ctx.strokeStyle = shadow;
  ctx.lineWidth = handleW * 0.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(baseX, topY);
  ctx.quadraticCurveTo(baseX + dir * handleW, (topY + bottomY) / 2, baseX, bottomY);
  ctx.stroke();
}

// ---------- footer (URL + QR) ----------

/**
 * Resolve the public share URL used in the footer + QR. Priority:
 *   1. `shareGuid` → `play.tournamental.com/s/<guid>`
 *   2. `footerUrl` (legacy)
 *   3. `tournamental.com/wc2026` (compat default)
 */
export function resolveShareUrl(input: BracketShareCardInput): string {
  if (input.shareGuid && /^[a-zA-Z0-9_-]{3,64}$/.test(input.shareGuid)) {
    return `${SHARE_BASE_URL}${input.shareGuid}`;
  }
  return input.footerUrl ?? "tournamental.com/wc2026";
}

async function paintFooter(
  ctx: SKRSContext2D,
  geom: Geom,
  input: BracketShareCardInput,
  accent: string,
  progress: number,
): Promise<void> {
  const alpha = easeIn(progress, 0.55, 0.85);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  const footerCy = geom.footerY + geom.footerHeight / 2;
  const url = resolveShareUrl(input);
  const fullUrl = url.startsWith("http") ? url : `https://${url}`;

  // QR on the right edge of the footer (so the URL text doesn't fight
  // with the wordmark). Wordmark goes below or beside it depending on
  // available room.
  const qrSize = geom.qrSize;
  const qrX = geom.w - geom.padX - qrSize;
  const qrY = footerCy - qrSize / 2;
  try {
    const img = await getQrImage(fullUrl, qrSize);
    ctx.drawImage(img, qrX, qrY, qrSize, qrSize);
    // Round the outer corners with a 4px clip overlay (just a thin
    // navy frame so the QR feels intentional rather than pasted).
    ctx.strokeStyle = hexToRgba(GOLD, 0.6);
    ctx.lineWidth = 1.5;
    roundRect(ctx, qrX, qrY, qrSize, qrSize, 4);
    ctx.stroke();
  } catch {
    // If QR rendering fails for any reason, skip silently — footer URL
    // still tells the viewer where to go.
  }

  // URL row. Mono font is just "DejaVu Sans Mono" if available; falling
  // back to DejaVu Sans is fine — the canvas font registry only knows
  // about whatever we registered in ensureFonts().
  ctx.fillStyle = INK_200;
  ctx.font = `700 ${geom.footerFont}px "DejaVu Sans", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  // "Predict yours at" prefix — only on landscape (the wider format).
  let textX = geom.padX;
  if (geom.size === "landscape") {
    const prefix = "Predict yours at";
    ctx.fillText(prefix, textX, footerCy);
    textX += ctx.measureText(prefix).width + 12;
  }

  ctx.fillStyle = GOLD;
  ctx.font = `700 ${geom.footerFont}px "DejaVu Sans Mono", "DejaVu Sans", monospace`;
  ctx.textAlign = "left";
  ctx.fillText(url, textX, footerCy);

  // Tournamental wordmark — bottom-centred-ish for portrait/square,
  // bottom-left for landscape (URL takes the centre).
  ctx.fillStyle = WHITE;
  ctx.font = `900 ${geom.wordmarkFont}px "DejaVu Sans", sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  // Slot the wordmark just left of the QR.
  ctx.fillText(BRAND_WORDMARK, qrX - 14, footerCy);

  // Optional pundit chip.
  if (input.pundit && input.pundit.level > 0) {
    const pundit = `Verified Pundit · L${input.pundit.level}`;
    ctx.fillStyle = accent;
    ctx.font = `700 ${geom.wordmarkFont - 2}px "DejaVu Sans", sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(pundit, qrX - 14, footerCy - 22);
  }
  ctx.restore();
}

// Cache for QR PNGs + decoded Images keyed by `<url>::<size>`. The same
// share-guid URL is re-rendered 16+ times during video frame production
// — encoding once and reusing the decoded `Image` avoids both QR
// generation and PNG decode on subsequent frames.
const qrPngCache = new Map<string, Buffer>();
const qrImageCache = new Map<string, Image>();

/**
 * Encode a URL as a small PNG QR code with our brand palette.
 *
 * Foreground: GOLD; background: BG_DARK (the same navy used across
 * the card so the QR sits flush). Error-correction level M is plenty
 * for a sub-200-byte URL at 50–80 px output.
 *
 * Cached per `(url, size)` so video frame rendering doesn't redo the
 * work 60+ times per share.
 */
export async function renderQrPng(url: string, size: number): Promise<Buffer> {
  const w = Math.max(32, Math.round(size));
  const key = `${url}::${w}`;
  const hit = qrPngCache.get(key);
  if (hit) return hit;
  const buffer = await QRCode.toBuffer(url, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: w,
    color: {
      dark: GOLD,
      light: BG_DARK,
    },
  });
  const out = buffer as Buffer;
  qrPngCache.set(key, out);
  return out;
}

/** Internal: get a decoded QR image (cached). */
async function getQrImage(url: string, size: number): Promise<Image> {
  const w = Math.max(32, Math.round(size));
  const key = `${url}::${w}`;
  const hit = qrImageCache.get(key);
  if (hit) return hit;
  const png = await renderQrPng(url, w);
  const img = await loadImage(png);
  qrImageCache.set(key, img);
  return img;
}

/** Test-only: clear the QR PNG cache. */
export function _resetQrCache(): void {
  qrPngCache.clear();
  qrImageCache.clear();
}

// ---------- pure helpers ----------

/** Pull the team at a given path stage and treat it as a Champion. */
function championFromPath(
  path: ReadonlyArray<BracketShareCardInput["knockoutPath"][number]>,
  stage: BracketShareCardInput["knockoutPath"][number]["stage"],
): BracketShareChampion | null {
  for (const entry of path) {
    if (entry && entry.stage === stage && entry.teamCode) {
      return { code: entry.teamCode, name: entry.teamName };
    }
  }
  return null;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function easeIn(progress: number, from: number, to: number): number {
  if (progress <= from) return 0;
  if (progress >= to) return 1;
  const t = (progress - from) / (to - from);
  return t * t * (3 - 2 * t);
}

function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function sanitiseHex(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1]!;
    const g = trimmed[2]!;
    const b = trimmed[3]!;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`;
  return null;
}

function hexToRgba(hex: string, alpha: number): string {
  const safe = sanitiseHex(hex) ?? "#000000";
  const r = parseInt(safe.slice(1, 3), 16);
  const g = parseInt(safe.slice(3, 5), 16);
  const b = parseInt(safe.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Suppress unused-warning for compatibility re-exports.
void STAGE_TO_LAYER;
void INK_400;
