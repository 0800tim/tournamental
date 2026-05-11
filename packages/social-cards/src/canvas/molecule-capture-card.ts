/**
 * Compose the user's captured 3D molecule PNG with a prediction-card
 * overlay (header + podium + path-to-gold + QR + Tournamental wordmark).
 *
 * Lives alongside `bracket-share-card.ts` so it shares the same palette,
 * font registry, and QR cache. The molecule capture flow (`apps/web/app/
 * api/share/molecule-capture/route.ts`) is the only consumer, but the
 * function is exported here to keep `@napi-rs/canvas` calls inside this
 * package — the web app declares `@vtorn/social-cards` as a workspace
 * dep, not `@napi-rs/canvas` directly.
 *
 * Output is a `Buffer` PNG sized per `size` (defaults to landscape
 * 1200×630, OG-friendly).
 */

import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import type { SKRSContext2D } from "@napi-rs/canvas";

import {
  CANVAS_SIZES,
  type BracketShareStage,
  type CanvasCardSize,
} from "./types.js";
import { renderQrPng } from "./bracket-share-card.js";

const BG_DARK = "#0a0e1a";
const INK_200 = "#cdd5e7";
const GOLD = "#f5c542";
const SILVER = "#d8dde6";
const BRONZE = "#d8954f";
const WHITE = "#ffffff";

const SHARE_BASE_URL = "play.tournamental.com/s/";
const PLAY_FALLBACK_URL = "play.tournamental.com/world-cup-2026";
const BRAND_WORDMARK = "Tournamental";

export interface MoleculeCaptureChampion {
  readonly code: string;
  readonly name: string;
  readonly kit?: { readonly primary?: string | null } | null;
}

export interface MoleculeCapturePathEntry {
  readonly stage: BracketShareStage;
  readonly teamCode: string;
  readonly teamName: string;
}

export interface MoleculeCaptureCardInput {
  /** PNG bytes of the user's captured WebGL canvas. Required. */
  readonly captureBuf: Buffer;
  /** Output size; defaults to landscape (1200×630). */
  readonly size?: CanvasCardSize;
  /** Drives the footer URL (`/s/<guid>`) + QR. */
  readonly shareGuid?: string | null;
  /** Display handle. Surfaces as "@handle" in the header. */
  readonly handle?: string | null;
  /** Tournament name (header right column). Default "FIFA WC 2026". */
  readonly tournamentName?: string;
  readonly champion?: MoleculeCaptureChampion | null;
  readonly runnerUp?: MoleculeCaptureChampion | null;
  readonly thirdPlace?: MoleculeCaptureChampion | null;
  readonly knockoutPath?: ReadonlyArray<MoleculeCapturePathEntry>;
}

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

export async function renderMoleculeCaptureCard(
  input: MoleculeCaptureCardInput,
): Promise<Buffer> {
  ensureFonts();
  const size: CanvasCardSize = input.size ?? "landscape";
  const dim = CANVAS_SIZES[size];
  const canvas = createCanvas(dim.width, dim.height);
  const ctx = canvas.getContext("2d");

  // 1. Background fill in case the captured PNG has transparent pixels.
  ctx.fillStyle = BG_DARK;
  ctx.fillRect(0, 0, dim.width, dim.height);

  // 2. Paint the captured molecule, cover-fitted so the user's pose stays
  //    recognisable even when aspect ratios differ.
  const capture = await loadImage(input.captureBuf);
  drawCover(ctx, capture, 0, 0, dim.width, dim.height);

  // 3. Top + bottom vignettes so the overlay text reads cleanly.
  paintVignette(ctx, dim.width, dim.height);

  // 4. Header (brand wordmark + tournament + handle).
  paintHeader(ctx, dim, input.handle ?? null, input.tournamentName ?? "FIFA WC 2026");

  // 5. Footer (podium + path strip + URL + QR).
  await paintFooter(ctx, dim, input);

  return canvas.toBuffer("image/png");
}

// ---------------------------------------------------------------------------
// Painters
// ---------------------------------------------------------------------------

interface Dim {
  readonly width: number;
  readonly height: number;
}

function paintVignette(ctx: SKRSContext2D, w: number, h: number): void {
  const top = ctx.createLinearGradient(0, 0, 0, Math.round(h * 0.18));
  top.addColorStop(0, hexToRgba(BG_DARK, 0.78));
  top.addColorStop(1, hexToRgba(BG_DARK, 0));
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, w, Math.round(h * 0.18));

  const bot = ctx.createLinearGradient(0, Math.round(h * 0.58), 0, h);
  bot.addColorStop(0, hexToRgba(BG_DARK, 0));
  bot.addColorStop(1, hexToRgba(BG_DARK, 0.92));
  ctx.fillStyle = bot;
  ctx.fillRect(0, Math.round(h * 0.58), w, Math.round(h * 0.42));
}

function paintHeader(
  ctx: SKRSContext2D,
  dim: Dim,
  handle: string | null,
  tournament: string,
): void {
  const padX = Math.round(dim.width * 0.04);
  const cy = Math.round(dim.height * 0.07);

  ctx.fillStyle = WHITE;
  ctx.font = `900 ${Math.round(dim.height * 0.04)}px "DejaVu Sans", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(BRAND_WORDMARK, padX, cy);

  ctx.fillStyle = INK_200;
  ctx.font = `700 ${Math.round(dim.height * 0.026)}px "DejaVu Sans", sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const right = handle ? `${tournament}  ·  @${handle}` : tournament;
  ctx.fillText(right, dim.width - padX, cy);
}

async function paintFooter(
  ctx: SKRSContext2D,
  dim: Dim,
  input: MoleculeCaptureCardInput,
): Promise<void> {
  const footerH = Math.round(dim.height * 0.34);
  const footerY = dim.height - footerH;

  paintPodium(ctx, dim, input, footerY + Math.round(footerH * 0.12));
  paintPathStrip(
    ctx,
    dim,
    input.knockoutPath ?? [],
    footerY + Math.round(footerH * 0.5),
  );
  await paintUrlAndQr(ctx, dim, input, footerY + footerH);
}

function paintPodium(
  ctx: SKRSContext2D,
  dim: Dim,
  input: MoleculeCaptureCardInput,
  centreY: number,
): void {
  const padX = Math.round(dim.width * 0.04);
  const parts: Array<{ label: string; champ: MoleculeCaptureChampion | null | undefined; tint: string }> = [
    { label: "GOLD", champ: input.champion ?? null, tint: GOLD },
    { label: "SILVER", champ: input.runnerUp ?? null, tint: SILVER },
    { label: "BRONZE", champ: input.thirdPlace ?? null, tint: BRONZE },
  ];

  const labelFont = Math.round(dim.height * 0.022);
  const teamFont = Math.round(dim.height * 0.036);

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  let x = padX;
  const gap = Math.round(dim.width * 0.025);
  for (const p of parts) {
    if (!p.champ?.code) continue;
    ctx.fillStyle = p.tint;
    ctx.font = `900 ${labelFont}px "DejaVu Sans", sans-serif`;
    ctx.fillText(p.label, x, centreY - Math.round(teamFont * 0.55));

    ctx.fillStyle = WHITE;
    ctx.font = `900 ${teamFont}px "DejaVu Sans", sans-serif`;
    const teamLine = `${p.champ.code}  ${truncate(p.champ.name, 14)}`;
    ctx.fillText(teamLine, x, centreY + Math.round(teamFont * 0.25));

    ctx.font = `900 ${labelFont}px "DejaVu Sans", sans-serif`;
    const wLabel = ctx.measureText(p.label).width;
    ctx.font = `900 ${teamFont}px "DejaVu Sans", sans-serif`;
    const wTeam = ctx.measureText(teamLine).width;
    x += Math.max(wLabel, wTeam) + gap;
  }
}

function paintPathStrip(
  ctx: SKRSContext2D,
  dim: Dim,
  path: ReadonlyArray<MoleculeCapturePathEntry>,
  centreY: number,
): void {
  if (path.length === 0) return;
  const padX = Math.round(dim.width * 0.04);
  const pillH = Math.round(dim.height * 0.045);
  const pillFont = Math.round(dim.height * 0.022);
  const gap = Math.round(dim.width * 0.012);

  ctx.textBaseline = "middle";
  ctx.font = `800 ${pillFont}px "DejaVu Sans", sans-serif`;

  let x = padX;
  ctx.fillStyle = INK_200;
  ctx.textAlign = "left";
  const lead = "PATH TO GOLD";
  ctx.fillText(lead, x, centreY);
  x += ctx.measureText(lead).width + gap;

  for (let i = 0; i < path.length; i += 1) {
    const entry = path[i]!;
    const stageLabel = stageLabelFor(entry.stage);
    const text = `${stageLabel} ${entry.teamCode}`;
    const w = ctx.measureText(text).width + Math.round(pillFont * 1.2);
    if (x + w > dim.width - padX) break;

    ctx.fillStyle = hexToRgba(GOLD, 0.16);
    roundRect(ctx, x, centreY - pillH / 2, w, pillH, pillH / 2);
    ctx.fill();

    ctx.fillStyle = GOLD;
    ctx.textAlign = "left";
    ctx.fillText(text, x + Math.round(pillFont * 0.6), centreY);

    x += w + gap;

    if (i < path.length - 1) {
      ctx.fillStyle = hexToRgba(GOLD, 0.55);
      ctx.font = `900 ${pillFont}px "DejaVu Sans", sans-serif`;
      const arrow = "›";
      ctx.fillText(arrow, x, centreY);
      x += ctx.measureText(arrow).width + gap;
      ctx.font = `800 ${pillFont}px "DejaVu Sans", sans-serif`;
    }
  }
}

async function paintUrlAndQr(
  ctx: SKRSContext2D,
  dim: Dim,
  input: MoleculeCaptureCardInput,
  bottomY: number,
): Promise<void> {
  const padX = Math.round(dim.width * 0.04);
  const padBottom = Math.round(dim.height * 0.04);
  const rowCy = bottomY - padBottom;

  const qrSize = Math.round(dim.height * 0.13);
  const qrX = dim.width - padX - qrSize;
  const qrY = rowCy - qrSize / 2;

  const shareUrl = resolveCaptureShareUrl(input.shareGuid);
  const fullUrl = shareUrl.startsWith("http") ? shareUrl : `https://${shareUrl}`;

  try {
    const qrPng = await renderQrPng(fullUrl, qrSize);
    const qrImg = await loadImage(qrPng);
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
    ctx.strokeStyle = hexToRgba(GOLD, 0.6);
    ctx.lineWidth = 1.5;
    roundRect(ctx, qrX, qrY, qrSize, qrSize, 4);
    ctx.stroke();
  } catch {
    // Drop the QR if rendering fails — the URL still tells viewers where
    // to go.
  }

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  const urlFont = Math.round(dim.height * 0.028);
  ctx.fillStyle = INK_200;
  ctx.font = `700 ${urlFont}px "DejaVu Sans", sans-serif`;
  const prefix = "Predict yours at";
  ctx.fillText(prefix, padX, rowCy);
  const prefixW = ctx.measureText(prefix).width;

  ctx.fillStyle = GOLD;
  ctx.font = `800 ${urlFont}px "DejaVu Sans", sans-serif`;
  ctx.fillText(shareUrl, padX + prefixW + 12, rowCy);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function drawCover(
  ctx: SKRSContext2D,
  img: Awaited<ReturnType<typeof loadImage>>,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const iw = img.width;
  const ih = img.height;
  if (iw === 0 || ih === 0) return;
  const targetRatio = w / h;
  const imgRatio = iw / ih;
  let sx = 0;
  let sy = 0;
  let sw = iw;
  let sh = ih;
  if (imgRatio > targetRatio) {
    sw = Math.round(ih * targetRatio);
    sx = Math.round((iw - sw) / 2);
  } else {
    sh = Math.round(iw / targetRatio);
    // Lean toward the top — the pyramid apex is the storytelling subject.
    sy = Math.round((ih - sh) * 0.4);
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function resolveCaptureShareUrl(shareGuid: string | undefined | null): string {
  if (shareGuid && /^[a-zA-Z0-9_-]{3,64}$/.test(shareGuid)) {
    return `${SHARE_BASE_URL}${shareGuid}`;
  }
  return PLAY_FALLBACK_URL;
}

function stageLabelFor(stage: BracketShareStage): string {
  switch (stage) {
    case "r16":
      return "R16";
    case "qf":
      return "QF";
    case "sf":
      return "SF";
    case "tp":
      return "3rd";
    case "final":
      return "Final";
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + "…";
}

function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Decode a `data:image/png;base64,...` URL (or bare base64) into a Buffer.
 * Returns `null` on any decoding failure or on suspiciously large
 * payloads (>6 MB) — capture inputs from the WebGL canvas at 2× DPR
 * comfortably fit under that ceiling.
 */
export function decodeCaptureDataUrl(raw: string | undefined | null): Buffer | null {
  if (!raw || typeof raw !== "string") return null;
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(raw.trim());
  const b64 = m ? m[1]! : raw.trim();
  if (!/^[A-Za-z0-9+/=]+$/.test(b64) || b64.length < 64) return null;
  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.length > 6 * 1024 * 1024) return null;
    return buf;
  } catch {
    return null;
  }
}
