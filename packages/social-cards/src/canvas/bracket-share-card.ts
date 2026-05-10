/**
 * Canvas-rendered bracket share card.
 *
 * Why a canvas pipeline next to satori? Tim's viral-share spec calls
 * for a champion-centric portrait built from flag rasters with a
 * kit-coloured radial-gradient backdrop. That's a 2D-canvas job, not
 * a flexbox job — satori is great for OG cards with text-heavy
 * layouts, terrible for centred-image-with-glow compositions.
 *
 * Output: a PNG `Buffer` ready to send as an HTTP response body or to
 * pipe into ffmpeg for the animated MP4 variant.
 *
 * Render approach:
 *   1. Create a `@napi-rs/canvas` canvas at the size preset.
 *   2. Paint the radial-gradient background using the champion's kit
 *      primary colour (defaulting to a navy accent if absent).
 *   3. Draw the top banner: V-mark + tournament label + handle.
 *   4. Centrepiece: the champion's flag at the largest size with a
 *      glowing ring + "MY CHAMPION" gold pill + country name.
 *   5. The knockout path beneath: a row per stage (R16 → Final) with
 *      the user's pick as a flag chip.
 *   6. Footer: "Predict yours at tournamental.com" + small wordmark.
 *
 * The renderer is `async` because flag SVGs are read + rasterised at
 * render time. The cost is bounded — flags cache after first read.
 */

import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import type { SKRSContext2D, Canvas } from "@napi-rs/canvas";

import { CANVAS_SIZES, STAGE_LABEL, type BracketShareCardInput, type CanvasCardSize } from "./types.js";
import { loadFlagPng } from "./flags.js";

const ACCENT_DEFAULT = "#7eb6e8"; // palette.accent[400]
const BG_DARK = "#0a0e1a";
const BG_DARK_2 = "#101626";
const INK_200 = "#cdd5e7";
const GOLD = "#f5c542";
const WHITE = "#ffffff";

let fontsRegistered = false;

/**
 * Register the bundled DejaVu fonts with @napi-rs/canvas. Idempotent.
 * Falls back silently if the font file isn't present at the path —
 * the renderer still produces a valid PNG with the system fallback.
 */
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
      // ignore — system fallback is fine
    }
  }
}

/**
 * Render the bracket share PNG.
 *
 * Returns a Node `Buffer` carrying a PNG image of the requested size.
 * Default size: `portrait` (1080×1350, Instagram-friendly).
 */
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

/**
 * Compose a single video frame onto an already-created canvas. The
 * video pipeline calls this once per frame with a varying `progress`
 * 0..1 timeline; the static-PNG path calls it once with `progress = 1`.
 *
 * This split keeps the layout logic in one place — the video pipeline
 * never has to know the geometry of the card.
 */
export async function paintBracketFrame(args: {
  canvas: Canvas;
  input: BracketShareCardInput;
  /** Stage in the 6-second reveal, 0..1. 1 means "full card visible". */
  progress: number;
}): Promise<void> {
  ensureFonts();
  const { canvas, input, progress } = args;
  const w = canvas.width;
  const h = canvas.height;
  const size: CanvasCardSize =
    input.size ?? (h >= w ? (w === 1080 && h === 1920 ? "portrait" : "portrait") : "landscape");
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
  // Solid dark navy floor.
  ctx.fillStyle = BG_DARK;
  ctx.fillRect(0, 0, w, h);

  // Radial glow seeded from the champion's kit primary (or accent default).
  const accent = sanitiseHex(kitPrimaryRaw) ?? ACCENT_DEFAULT;
  const cx = w / 2;
  const cy = h * 0.42;
  const radius = Math.max(w, h) * 0.7;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g.addColorStop(0, hexToRgba(accent, 0.38));
  g.addColorStop(0.45, hexToRgba(accent, 0.18));
  g.addColorStop(1, hexToRgba(BG_DARK, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Subtle bottom-fade to keep the footer text readable.
  const fade = ctx.createLinearGradient(0, h * 0.55, 0, h);
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

  // Geometry presets per size — tuned by eye to keep the same visual
  // hierarchy at every aspect ratio (champion biggest, path beneath,
  // footer at the bottom).
  const geom = layoutGeometry(size, w, h);

  // ----- 1. Header strip -----
  await paintHeader(ctx, geom, input, accent, progress);

  // ----- 2. Champion centrepiece -----
  await paintChampion(ctx, geom, input, accent, progress);

  // ----- 3. Knockout path strip -----
  await paintKnockoutPath(ctx, geom, input, progress);

  // ----- 4. Footer -----
  paintFooter(ctx, geom, input, accent, progress);
}

interface Geom {
  size: CanvasCardSize;
  w: number;
  h: number;
  padX: number;
  // Header
  headerY: number;
  headerHeight: number;
  // Champion
  championCenterX: number;
  championCenterY: number;
  championFlagWidth: number;
  championLabelGap: number;
  // Knockout path
  pathY: number;
  pathRowHeight: number;
  pathLeft: number;
  pathRight: number;
  // Footer
  footerY: number;
  footerHeight: number;
  // Typography
  titleFont: number;
  handleFont: number;
  championNameFont: number;
  championPillFont: number;
  pathStageFont: number;
  pathTeamFont: number;
  footerFont: number;
  wordmarkFont: number;
}

function layoutGeometry(size: CanvasCardSize, w: number, h: number): Geom {
  // The portrait preset is the "reference" layout; the others are
  // tuned variants — every dimension is a fraction of width/height so
  // we keep the same look across sizes.
  if (size === "landscape") {
    return {
      size,
      w,
      h,
      padX: 56,
      headerY: 36,
      headerHeight: 70,
      championCenterX: w * 0.32,
      championCenterY: h * 0.55,
      championFlagWidth: Math.round(h * 0.5),
      championLabelGap: 14,
      pathY: h * 0.22,
      pathRowHeight: 60,
      pathLeft: w * 0.6,
      pathRight: w - 56,
      footerY: h - 64,
      footerHeight: 44,
      titleFont: 28,
      handleFont: 22,
      championNameFont: 48,
      championPillFont: 18,
      pathStageFont: 18,
      pathTeamFont: 24,
      footerFont: 18,
      wordmarkFont: 16,
    };
  }
  if (size === "square") {
    return {
      size,
      w,
      h,
      padX: 64,
      headerY: 48,
      headerHeight: 84,
      championCenterX: w / 2,
      championCenterY: h * 0.43,
      championFlagWidth: Math.round(w * 0.32),
      championLabelGap: 18,
      pathY: h * 0.68,
      pathRowHeight: 56,
      pathLeft: 64,
      pathRight: w - 64,
      footerY: h - 88,
      footerHeight: 56,
      titleFont: 30,
      handleFont: 24,
      championNameFont: 60,
      championPillFont: 20,
      pathStageFont: 20,
      pathTeamFont: 28,
      footerFont: 22,
      wordmarkFont: 18,
    };
  }
  // portrait (default — 1080 × 1350)
  return {
    size,
    w,
    h,
    padX: 64,
    headerY: 56,
    headerHeight: 88,
    championCenterX: w / 2,
    championCenterY: h * 0.36,
    championFlagWidth: Math.round(w * 0.36),
    championLabelGap: 20,
    pathY: h * 0.6,
    pathRowHeight: 64,
    pathLeft: 64,
    pathRight: w - 64,
    footerY: h - 108,
    footerHeight: 72,
    titleFont: 34,
    handleFont: 26,
    championNameFont: 72,
    championPillFont: 22,
    pathStageFont: 22,
    pathTeamFont: 30,
    footerFont: 24,
    wordmarkFont: 20,
  };
}

async function paintHeader(
  ctx: SKRSContext2D,
  geom: Geom,
  input: BracketShareCardInput,
  accent: string,
  progress: number,
): Promise<void> {
  const headerAlpha = easeIn(progress, 0.0, 0.25);
  if (headerAlpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = headerAlpha;

  // V-mark + wordmark on the left.
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
  ctx.fillText("V", markX + markSize / 2, markY + markSize / 2 + 2);

  ctx.fillStyle = WHITE;
  ctx.font = `900 ${geom.titleFont}px "DejaVu Sans", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("TOURNAMENT·AL", markX + markSize + 14, markY + markSize / 2 + 2);

  // Title on the right or beneath (portrait stacks).
  const title = `${input.tournamentName} — MY BRACKET`;
  const handle = `@${input.user.handle}`;
  ctx.textBaseline = "middle";

  if (geom.size === "landscape") {
    ctx.fillStyle = INK_200;
    ctx.font = `700 ${geom.handleFont}px "DejaVu Sans", sans-serif`;
    ctx.textAlign = "right";
    const yMid = markY + markSize / 2;
    ctx.fillText(title, geom.w - geom.padX, yMid - 14);
    ctx.fillStyle = WHITE;
    ctx.fillText(handle, geom.w - geom.padX, yMid + 14);
  } else {
    ctx.fillStyle = INK_200;
    ctx.font = `700 ${geom.handleFont}px "DejaVu Sans", sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(title, geom.w - geom.padX, markY + markSize / 2 - 12);
    ctx.fillStyle = WHITE;
    ctx.fillText(handle, geom.w - geom.padX, markY + markSize / 2 + 16);
  }
  ctx.restore();
}

async function paintChampion(
  ctx: SKRSContext2D,
  geom: Geom,
  input: BracketShareCardInput,
  accent: string,
  progress: number,
): Promise<void> {
  const showFrom = 0.25;
  const showTo = 0.85;
  const alpha = easeIn(progress, showFrom, showTo);
  if (alpha <= 0) return;

  // Final-burst zoom: at end-of-timeline the champion eases up to 1.18x.
  const zoom = 1 + 0.18 * Math.max(0, (progress - 0.83) / 0.17);
  const flagW = Math.round(geom.championFlagWidth * zoom);
  const flagH = Math.round(flagW * (2 / 3));

  const cx = geom.championCenterX;
  const cy = geom.championCenterY;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Glow ring behind the flag — radial gradient blob, kit-coloured.
  const glow = ctx.createRadialGradient(cx, cy, flagW * 0.3, cx, cy, flagW * 1.1);
  glow.addColorStop(0, hexToRgba(accent, 0.6));
  glow.addColorStop(0.6, hexToRgba(accent, 0.18));
  glow.addColorStop(1, hexToRgba(accent, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, flagW * 1.15, 0, Math.PI * 2);
  ctx.fill();

  // Draw the flag.
  try {
    const png = await loadFlagPng({
      code: input.champion.code,
      width: flagW,
      flagsDir: input.flagsDir,
      placeholderColour: accent,
    });
    const img = await loadImage(png);
    const x = cx - flagW / 2;
    const y = cy - flagH / 2;
    // Frame the flag with a thin accent stroke.
    ctx.save();
    roundRect(ctx, x - 4, y - 4, flagW + 8, flagH + 8, 14);
    ctx.fillStyle = hexToRgba(WHITE, 0.95);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, x, y, flagW, flagH, 10);
    ctx.clip();
    ctx.drawImage(img, x, y, flagW, flagH);
    ctx.restore();

    ctx.save();
    roundRect(ctx, x, y, flagW, flagH, 10);
    ctx.lineWidth = 2;
    ctx.strokeStyle = hexToRgba(accent, 0.9);
    ctx.stroke();
    ctx.restore();
  } catch {
    // Loading failure — skip the flag, the gradient is still nice.
  }

  // Gold "MY CHAMPION" pill — only appears in the last beat of the reveal.
  const pillAlpha = easeIn(progress, 0.6, 0.85);
  if (pillAlpha > 0) {
    ctx.globalAlpha = alpha * pillAlpha;
    const pillText = "MY CHAMPION";
    ctx.font = `900 ${geom.championPillFont}px "DejaVu Sans", sans-serif`;
    const padPill = 16;
    const pillW = ctx.measureText(pillText).width + padPill * 2;
    const pillH = Math.round(geom.championPillFont * 1.7);
    const pillX = cx - pillW / 2;
    const pillY = cy - flagH / 2 - pillH - 12;
    ctx.fillStyle = GOLD;
    roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.fillStyle = BG_DARK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(pillText, cx, pillY + pillH / 2 + 1);
    ctx.globalAlpha = alpha;
  }

  // Country name beneath the flag.
  const nameAlpha = easeIn(progress, 0.45, 0.75);
  if (nameAlpha > 0) {
    ctx.globalAlpha = alpha * nameAlpha;
    ctx.fillStyle = WHITE;
    ctx.font = `900 ${geom.championNameFont}px "DejaVu Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(
      input.champion.name.toUpperCase(),
      cx,
      cy + flagH / 2 + geom.championLabelGap,
    );
  }

  ctx.restore();
}

async function paintKnockoutPath(
  ctx: SKRSContext2D,
  geom: Geom,
  input: BracketShareCardInput,
  progress: number,
): Promise<void> {
  const showFrom = 0.4;
  const showTo = 0.9;
  const alpha = easeIn(progress, showFrom, showTo);
  if (alpha <= 0) return;

  const path = canonicalisePath(input.knockoutPath);
  if (path.length === 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Container card behind the path rows.
  const containerX = geom.pathLeft;
  const containerY = geom.pathY;
  const containerW = geom.pathRight - geom.pathLeft;
  const containerH = path.length * geom.pathRowHeight + 24;
  ctx.fillStyle = hexToRgba(BG_DARK_2, 0.7);
  roundRect(ctx, containerX, containerY, containerW, containerH, 18);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Each row is a per-stage flag chip.
  for (let i = 0; i < path.length; i++) {
    const row = path[i]!;
    const rowY = containerY + 12 + i * geom.pathRowHeight + geom.pathRowHeight / 2;
    const rowAppear = easeIn(progress, showFrom + i * 0.04, showFrom + 0.15 + i * 0.04);
    ctx.save();
    ctx.globalAlpha = alpha * rowAppear;

    // Stage label on the left.
    ctx.fillStyle = INK_200;
    ctx.font = `700 ${geom.pathStageFont}px "DejaVu Sans", sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(STAGE_LABEL[row.stage], containerX + 24, rowY);

    // Flag mini on the right + team name.
    const miniW = Math.round(geom.pathRowHeight * 0.95);
    const miniH = Math.round(miniW * (2 / 3));
    const miniX = containerX + containerW - miniW - 24;
    const miniY = rowY - miniH / 2;
    try {
      const png = await loadFlagPng({
        code: row.teamCode,
        width: miniW,
        flagsDir: input.flagsDir,
      });
      const img = await loadImage(png);
      ctx.save();
      roundRect(ctx, miniX, miniY, miniW, miniH, 5);
      ctx.clip();
      ctx.drawImage(img, miniX, miniY, miniW, miniH);
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      roundRect(ctx, miniX, miniY, miniW, miniH, 5);
      ctx.stroke();
    } catch {
      // Skip — text fallback only.
    }

    ctx.fillStyle = WHITE;
    ctx.font = `700 ${geom.pathTeamFont}px "DejaVu Sans", sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(row.teamName, miniX - 16, rowY);

    ctx.restore();
  }

  ctx.restore();
}

function paintFooter(
  ctx: SKRSContext2D,
  geom: Geom,
  input: BracketShareCardInput,
  accent: string,
  progress: number,
): void {
  const alpha = easeIn(progress, 0.55, 0.85);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.fillStyle = WHITE;
  ctx.font = `700 ${geom.footerFont}px "DejaVu Sans", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const footerLeftText = "Predict yours at";
  const footerY = geom.footerY + geom.footerHeight / 2;
  ctx.fillStyle = INK_200;
  ctx.fillText(footerLeftText, geom.padX, footerY);

  const url = input.footerUrl ?? "tournamental.com/wc2026";
  ctx.fillStyle = GOLD;
  const leftW = ctx.measureText(footerLeftText).width;
  ctx.fillText(url, geom.padX + leftW + 12, footerY);

  // Tournament·al wordmark bottom-right.
  ctx.fillStyle = WHITE;
  ctx.font = `900 ${geom.wordmarkFont}px "DejaVu Sans", sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText("Tournament·al", geom.w - geom.padX, footerY);

  // Optional pundit chip near the wordmark (small + gold).
  if (input.pundit && input.pundit.level > 0) {
    const pundit = `Verified Pundit · L${input.pundit.level}`;
    ctx.fillStyle = accent;
    ctx.font = `700 ${geom.wordmarkFont - 2}px "DejaVu Sans", sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(pundit, geom.w - geom.padX, footerY - 24);
  }
  ctx.restore();
}

// ---------- pure helpers ----------

/** Drop entries with empty codes; cap at 5 (R16, QF, SF, [TP], Final). */
function canonicalisePath(
  input: ReadonlyArray<BracketShareCardInput["knockoutPath"][number]>,
): Array<BracketShareCardInput["knockoutPath"][number]> {
  const order: Record<string, number> = {
    r16: 0,
    qf: 1,
    sf: 2,
    tp: 3,
    final: 4,
  };
  const seen = new Map<string, BracketShareCardInput["knockoutPath"][number]>();
  for (const entry of input) {
    if (!entry || !entry.teamCode) continue;
    seen.set(entry.stage, entry);
  }
  return Array.from(seen.values())
    .sort((a, b) => (order[a.stage] ?? 9) - (order[b.stage] ?? 9))
    .slice(0, 5);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Smoothstep-style ease from 0..1 inside the [from,to] sub-window. */
function easeIn(progress: number, from: number, to: number): number {
  if (progress <= from) return 0;
  if (progress >= to) return 1;
  const t = (progress - from) / (to - from);
  // smoothstep
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

/** Normalise a possibly-#-prefixed CSS hex. Returns null if invalid. */
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
