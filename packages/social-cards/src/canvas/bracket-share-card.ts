/**
 * Canvas-rendered bracket share card.
 *
 * Layout (Tim spec, 2026-05-11):
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │ [V] Tournamental       FIFA WC 2026 — MY BRACKET     │  header
 *   │                                              @handle │
 *   ├──────────────────────────┬───────────────────────────┤
 *   │   PATH TO GOLD            │      MY PODIUM             │
 *   │   R16  → 🇦🇷 ARG          │           🥇                │
 *   │   QF   → 🇦🇷 ARG          │         (gold)              │
 *   │   SF   → 🇦🇷 ARG          │    🥈           🥉          │
 *   │   Final → 🇦🇷 ARG         │  (silver)    (bronze)       │
 *   │                          │   FRA          BRA           │
 *   ├──────────────────────────┴───────────────────────────┤
 *   │ Predict yours at tournamental.com/wc2026  Tournamental│  footer
 *   └──────────────────────────────────────────────────────┘
 *
 * Why this shape (vs. the earlier centerpiece-flag design): Tim wants
 * the share to read as a complete prediction — not just "I picked
 * Argentina" but "here's my full top-3 and how I got there". The
 * podium replaces the floating-flag champion; the user's champion
 * occupies the gold cup at the top.
 *
 * Output: a PNG `Buffer` ready to send as an HTTP response body or to
 * pipe into ffmpeg for the animated MP4 variant.
 */

import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import type { SKRSContext2D, Canvas } from "@napi-rs/canvas";

import {
  CANVAS_SIZES,
  STAGE_LABEL,
  type BracketShareCardInput,
  type BracketShareChampion,
  type CanvasCardSize,
} from "./types.js";
import { loadFlagPng } from "./flags.js";

const ACCENT_DEFAULT = "#7eb6e8";
const BG_DARK = "#0a0e1a";
const BG_DARK_2 = "#101626";
const INK_200 = "#cdd5e7";
const GOLD = "#f5c542";
const GOLD_DEEP = "#b8862a";
const SILVER = "#d8dde6";
const SILVER_DEEP = "#8c93a3";
const BRONZE = "#d8954f";
const BRONZE_DEEP = "#854a1d";
const WHITE = "#ffffff";

const BRAND_WORDMARK = "Tournamental";

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
  await paintBracketPath(ctx, geom, input, progress);
  await paintPodium(ctx, geom, input, accent, progress);
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
  pathStageFont: number;
  pathTeamFont: number;
  podiumLabelFont: number;
  podiumTeamFont: number;
  podiumNameFont: number;
  footerFont: number;
  wordmarkFont: number;
}

function layoutGeometry(size: CanvasCardSize, w: number, h: number): Geom {
  if (size === "landscape") {
    // 1200 x 630 — header + body + footer
    return {
      size, w, h,
      padX: 48,
      headerY: 28,
      headerHeight: 58,
      leftX: 48,
      leftWidth: w * 0.42 - 48,
      rightX: w * 0.46,
      rightWidth: w - w * 0.46 - 48,
      bodyTop: 110,
      bodyBottom: h - 70,
      footerY: h - 56,
      footerHeight: 40,
      titleFont: 24,
      handleFont: 18,
      sectionLabelFont: 18,
      pathStageFont: 16,
      pathTeamFont: 20,
      podiumLabelFont: 16,
      podiumTeamFont: 18,
      podiumNameFont: 28,
      footerFont: 16,
      wordmarkFont: 14,
    };
  }
  if (size === "square") {
    // 1080 x 1080
    return {
      size, w, h,
      padX: 56,
      headerY: 44,
      headerHeight: 80,
      leftX: 56,
      leftWidth: w * 0.42 - 56,
      rightX: w * 0.46,
      rightWidth: w - w * 0.46 - 56,
      bodyTop: 160,
      bodyBottom: h - 110,
      footerY: h - 88,
      footerHeight: 56,
      titleFont: 28,
      handleFont: 22,
      sectionLabelFont: 22,
      pathStageFont: 20,
      pathTeamFont: 26,
      podiumLabelFont: 20,
      podiumTeamFont: 24,
      podiumNameFont: 40,
      footerFont: 22,
      wordmarkFont: 18,
    };
  }
  // portrait (default — 1080 × 1350)
  return {
    size, w, h,
    padX: 60,
    headerY: 52,
    headerHeight: 88,
    leftX: 60,
    leftWidth: w * 0.42 - 60,
    rightX: w * 0.46,
    rightWidth: w - w * 0.46 - 60,
    bodyTop: 200,
    bodyBottom: h - 140,
    footerY: h - 110,
    footerHeight: 70,
    titleFont: 32,
    handleFont: 24,
    sectionLabelFont: 24,
    pathStageFont: 22,
    pathTeamFont: 30,
    podiumLabelFont: 22,
    podiumTeamFont: 28,
    podiumNameFont: 56,
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

async function paintBracketPath(
  ctx: SKRSContext2D,
  geom: Geom,
  input: BracketShareCardInput,
  progress: number,
): Promise<void> {
  const alpha = easeIn(progress, 0.25, 0.7);
  if (alpha <= 0) return;
  const path = canonicalisePath(input.knockoutPath, ["r16", "qf", "sf", "final"]);
  if (path.length === 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Section label.
  ctx.fillStyle = GOLD;
  ctx.font = `900 ${geom.sectionLabelFont}px "DejaVu Sans", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("PATH TO GOLD", geom.leftX, geom.bodyTop);

  // Container card for the path rows.
  const containerY = geom.bodyTop + geom.sectionLabelFont + 16;
  const containerH = Math.min(
    geom.bodyBottom - containerY,
    path.length * (geom.pathTeamFont + 32) + 24,
  );
  const containerX = geom.leftX;
  const containerW = geom.leftWidth;
  ctx.fillStyle = hexToRgba(BG_DARK_2, 0.7);
  roundRect(ctx, containerX, containerY, containerW, containerH, 16);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const rowH = Math.floor((containerH - 24) / path.length);
  for (let i = 0; i < path.length; i++) {
    const row = path[i]!;
    const rowAlpha = easeIn(progress, 0.3 + i * 0.05, 0.45 + i * 0.05);
    const rowY = containerY + 12 + i * rowH + rowH / 2;

    ctx.save();
    ctx.globalAlpha = alpha * rowAlpha;

    // Stage label on the left.
    ctx.fillStyle = INK_200;
    ctx.font = `700 ${geom.pathStageFont}px "DejaVu Sans", sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(STAGE_LABEL[row.stage], containerX + 20, rowY);

    // Flag chip on the right + team code.
    const flagH = Math.max(28, rowH - 18);
    const flagW = Math.round(flagH * 1.5);
    const flagX = containerX + containerW - flagW - 20;
    const flagY = rowY - flagH / 2;
    try {
      const png = await loadFlagPng({
        code: row.teamCode,
        width: flagW,
        flagsDir: input.flagsDir,
      });
      const img = await loadImage(png);
      ctx.save();
      roundRect(ctx, flagX, flagY, flagW, flagH, 4);
      ctx.clip();
      ctx.drawImage(img, flagX, flagY, flagW, flagH);
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 1;
      roundRect(ctx, flagX, flagY, flagW, flagH, 4);
      ctx.stroke();
    } catch {
      // skip
    }

    ctx.fillStyle = WHITE;
    ctx.font = `700 ${geom.pathTeamFont}px "DejaVu Sans", sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(row.teamName, flagX - 14, rowY);

    ctx.restore();
  }

  ctx.restore();
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

  // Derive the runner-up + third place if explicit fields aren't present.
  const silver: BracketShareChampion | null = input.runnerUp ?? null;
  const bronze: BracketShareChampion | null =
    input.thirdPlace ?? championFromPath(input.knockoutPath, "tp");

  ctx.save();
  ctx.globalAlpha = alpha;

  // Section label.
  ctx.fillStyle = GOLD;
  ctx.font = `900 ${geom.sectionLabelFont}px "DejaVu Sans", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("MY PODIUM", geom.rightX, geom.bodyTop);

  // Layout the three cups in a classic podium step.
  // Gold sits centred + tallest; silver left + medium; bronze right +
  // smallest. Each cup has a baseplate (the "podium step") under it.
  const rightCx = geom.rightX + geom.rightWidth / 2;
  const podiumTop = geom.bodyTop + geom.sectionLabelFont + 24;
  const podiumHeight = geom.bodyBottom - podiumTop;

  // Scale cup sizes against the right-column width so all three sizes
  // (portrait / square / landscape) keep the same hierarchy.
  const baseUnit = Math.min(geom.rightWidth / 3.2, podiumHeight / 4.2);
  const goldCupW = Math.round(baseUnit * 1.35);
  const sideCupW = Math.round(baseUnit * 0.95);
  const cupGap = Math.round(baseUnit * 0.35);

  // Vertical placement: gold higher up, sides lower.
  const goldBaseline = podiumTop + Math.round(podiumHeight * 0.55);
  const sideBaseline = goldBaseline + Math.round(baseUnit * 0.25);

  const goldCx = rightCx;
  const silverCx = goldCx - goldCupW / 2 - sideCupW / 2 - cupGap;
  const bronzeCx = goldCx + goldCupW / 2 + sideCupW / 2 + cupGap;

  // Render the three cups (silver + bronze first so gold sits on top).
  await renderPodiumColumn(ctx, {
    centerX: silverCx,
    baseline: sideBaseline,
    cupWidth: sideCupW,
    rank: 2,
    label: "2ND",
    team: silver,
    fill: SILVER,
    shadow: SILVER_DEEP,
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
    podiumLabelFont: geom.podiumLabelFont,
    podiumTeamFont: geom.podiumTeamFont,
    flagsDir: input.flagsDir,
    progress,
    showFrom: 0.4,
    showTo: 0.7,
    // Gold gets a glow ring tied to the champion's kit colour.
    glowAccent: accent,
  });

  // Champion country name below the podium — bold + biggest text.
  const nameAlpha = easeIn(progress, 0.6, 0.85);
  if (nameAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = alpha * nameAlpha;
    ctx.fillStyle = WHITE;
    ctx.font = `900 ${geom.podiumNameFont}px "DejaVu Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const champLineY = goldBaseline + Math.round(baseUnit * 1.2);
    ctx.fillText(
      input.champion.name.toUpperCase(),
      rightCx,
      champLineY,
    );
    // "My champion" subtitle pill.
    const pillText = "MY CHAMPION";
    ctx.font = `900 ${geom.podiumLabelFont}px "DejaVu Sans", sans-serif`;
    const padPill = 14;
    const pillW = ctx.measureText(pillText).width + padPill * 2;
    const pillH = Math.round(geom.podiumLabelFont * 1.7);
    const pillX = rightCx - pillW / 2;
    const pillY = champLineY + geom.podiumNameFont + 12;
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

  // The cup is drawn anchored at (centerX, baseline) — baseline is the
  // bottom of the cup's base plate. Width scales the entire trophy.
  const w = args.cupWidth;
  const cx = args.centerX;
  const baseY = args.baseline;
  // Trophy proportions (relative to width):
  const bowlW = w;
  const bowlH = w * 0.95;
  const stemH = w * 0.18;
  const baseW = w * 1.05;
  const baseH = w * 0.18;
  const handleW = w * 0.22;

  ctx.save();
  ctx.globalAlpha = colAlpha;

  // Glow halo for the gold cup.
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

  // Stem (vertical bar between base and bowl).
  const stemW = w * 0.22;
  const stemTop = baseTop - stemH;
  ctx.fillStyle = args.shadow;
  ctx.fillRect(cx - stemW / 2, stemTop, stemW, stemH);
  ctx.fillStyle = args.fill;
  ctx.fillRect(cx - stemW / 2 + 2, stemTop, stemW - 4, stemH);

  // Handles (curved C-shapes on either side of the bowl).
  drawCupHandle(ctx, cx, stemTop, bowlW, bowlH, handleW, args.shadow, "left");
  drawCupHandle(ctx, cx, stemTop, bowlW, bowlH, handleW, args.shadow, "right");

  // Bowl (rounded U-shape sitting on the stem).
  drawCupBowl(ctx, cx - bowlW / 2, stemTop - bowlH, bowlW, bowlH, args.fill, args.shadow);

  // Rank label (1ST / 2ND / 3RD) painted on the bowl.
  ctx.fillStyle = BG_DARK;
  const labelFont = Math.round(bowlH * 0.32);
  ctx.font = `900 ${labelFont}px "DejaVu Sans", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(args.label, cx, stemTop - bowlH / 2 + 4);

  // Flag chip + team code beneath the base plate.
  const chipY = baseY + 12;
  if (args.team && args.team.code) {
    const chipW = Math.round(w * 0.95);
    const chipH = Math.round(chipW * 0.6);
    const chipX = cx - chipW / 2;
    try {
      const png = await loadFlagPng({
        code: args.team.code,
        width: chipW,
        flagsDir: args.flagsDir,
      });
      const img = await loadImage(png);
      ctx.save();
      roundRect(ctx, chipX, chipY, chipW, chipH, 6);
      ctx.clip();
      ctx.drawImage(img, chipX, chipY, chipW, chipH);
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1.5;
      roundRect(ctx, chipX, chipY, chipW, chipH, 6);
      ctx.stroke();
    } catch {
      // skip flag fallback — code label below still renders
    }
    ctx.fillStyle = WHITE;
    ctx.font = `900 ${args.podiumTeamFont}px "DejaVu Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(args.team.code.toUpperCase(), cx, chipY + chipH + 8);
  } else {
    // No team picked at this slot — show a dashed "?" placeholder so the
    // viewer still sees three columns and the layout doesn't collapse.
    const chipW = Math.round(w * 0.95);
    const chipH = Math.round(chipW * 0.6);
    const chipX = cx - chipW / 2;
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, chipX, chipY, chipW, chipH, 6);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = INK_200;
    ctx.font = `900 ${Math.round(args.podiumTeamFont * 1.3)}px "DejaVu Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", cx, chipY + chipH / 2 + 2);
  }

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

function drawCupBowl(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  shadow: string,
): void {
  // Outer (shadow) shape — a U with a slight inward taper at the bottom.
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w - w * 0.08, y + h);
  ctx.quadraticCurveTo(x + w / 2, y + h * 1.08, x + w * 0.08, y + h);
  ctx.closePath();
  ctx.fill();

  // Inner highlight (fill) — same shape but 4 px inset.
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 4);
  ctx.lineTo(x + w - 4, y + 4);
  ctx.lineTo(x + w - 4 - w * 0.08, y + h - 4);
  ctx.quadraticCurveTo(x + w / 2, y + h * 1.02 - 4, x + 4 + w * 0.08, y + h - 4);
  ctx.closePath();
  ctx.fill();

  // Rim — thin horizontal accent at the top of the bowl.
  ctx.fillStyle = shadow;
  ctx.fillRect(x - 4, y - 4, w + 8, 6);
  ctx.fillStyle = fill;
  ctx.fillRect(x - 2, y - 2, w + 4, 4);
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

  const footerY = geom.footerY + geom.footerHeight / 2;
  ctx.font = `700 ${geom.footerFont}px "DejaVu Sans", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const footerLeftText = "Predict yours at";
  ctx.fillStyle = INK_200;
  ctx.fillText(footerLeftText, geom.padX, footerY);

  const url = input.footerUrl ?? "tournamental.com/wc2026";
  ctx.fillStyle = GOLD;
  const leftW = ctx.measureText(footerLeftText).width;
  ctx.fillText(url, geom.padX + leftW + 12, footerY);

  // Tournamental wordmark bottom-right.
  ctx.fillStyle = WHITE;
  ctx.font = `900 ${geom.wordmarkFont}px "DejaVu Sans", sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText(BRAND_WORDMARK, geom.w - geom.padX, footerY);

  // Optional pundit chip near the wordmark.
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

function canonicalisePath(
  input: ReadonlyArray<BracketShareCardInput["knockoutPath"][number]>,
  keepStages?: ReadonlyArray<BracketShareCardInput["knockoutPath"][number]["stage"]>,
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
    if (keepStages && !keepStages.includes(entry.stage)) continue;
    seen.set(entry.stage, entry);
  }
  return Array.from(seen.values())
    .sort((a, b) => (order[a.stage] ?? 9) - (order[b.stage] ?? 9))
    .slice(0, 5);
}

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
