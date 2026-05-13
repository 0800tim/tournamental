/**
 * Viral podium share card (v3) — 2026-05-14.
 *
 * Tim's brief: drop the molecule/pyramid silhouette from the share
 * card entirely. The captured PNG is too small for the molecule to
 * read; what wants to be there is a captivating podium with the
 * three big flags, the user's handle + avatar, and a champion-kit
 * gradient background. Top-8 strip is deferred.
 *
 * Layout (landscape — 1200×630):
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ (●) @handle               FOOTBALL WORLD CUP 2026         │ header
 *   │     name                                                   │
 *   │                                                            │
 *   │            🥈                🏆                🥉           │
 *   │         ┌──────┐         ┌────────┐         ┌──────┐        │ podium
 *   │         │ FLAG │         │  FLAG  │         │ FLAG │        │
 *   │         │ FRA  │         │  BRA   │         │ ARG  │        │
 *   │         └──────┘         └────────┘         └──────┘        │
 *   │           2ND               1ST               3RD           │
 *   │                                                            │
 *   │  Predict yours · play.tournamental.com/s/<g>       [QR]    │ footer
 *   └────────────────────────────────────────────────────────────┘
 *
 * Portrait + square variants compress vertically; the three medal
 * tiles are always present.
 *
 * Background: champion-kit-primary radial gradient over a dark base.
 * If the bracket has no resolved champion, falls back to the
 * Tournamental accent blue.
 */

import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import type { SKRSContext2D, Image } from "@napi-rs/canvas";
import * as QRCode from "qrcode";

import {
  CANVAS_SIZES,
  type BracketShareCardInput,
  type CanvasCardSize,
} from "./types.js";
import { loadFlagImage } from "./flags.js";

const BG_DARK = "#0a0e1a";
const BG_DARK_2 = "#101626";
const INK_100 = "#f5f7fb";
const INK_300 = "#cdd5e7";
const INK_500 = "#94a3b8";
const ACCENT_DEFAULT = "#7eb6e8";
const GOLD = "#f5c542";
const SILVER = "#d8dde6";
const BRONZE = "#d8954f";
const WHITE = "#ffffff";

const SHARE_BASE_URL = "play.tournamental.com/s/";
const BRAND_WORDMARK = "Tournamental";

let fontsRegistered = false;
function ensureFonts(): void {
  if (fontsRegistered) return;
  fontsRegistered = true;
  const dejavu = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ];
  for (const path of dejavu) {
    try {
      GlobalFonts.registerFromPath(path, "DejaVu Sans");
    } catch {
      // ignore — system fallback is fine
    }
  }
  // Color emoji fallback so the 🏆/🥈/🥉 cup glyphs render. The font
  // family name "Noto Color Emoji" is appended after "DejaVu Sans" in
  // the font-stack so emoji-only codepoints route here while text
  // codepoints keep DejaVu's metrics.
  try {
    GlobalFonts.registerFromPath(
      "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
      "Noto Color Emoji",
    );
  } catch {
    // ignore — without emoji we fall back to solid medal discs
  }
}

export async function renderViralPodiumCard(
  input: BracketShareCardInput,
): Promise<Buffer> {
  ensureFonts();
  const size: CanvasCardSize = input.size ?? "landscape";
  const dim = CANVAS_SIZES[size];
  const canvas = createCanvas(dim.width, dim.height);
  const ctx = canvas.getContext("2d");

  const accent = sanitiseHex(input.champion.kit?.primary) ?? ACCENT_DEFAULT;

  paintBackground(ctx, dim.width, dim.height, accent);
  await paintHeader(ctx, dim.width, dim.height, size, input);
  await paintPodium(ctx, dim.width, dim.height, size, input);
  await paintFooter(ctx, dim.width, dim.height, size, input, accent);

  return canvas.toBuffer("image/png");
}

// ---------- internals ----------

function paintBackground(
  ctx: SKRSContext2D,
  w: number,
  h: number,
  accent: string,
): void {
  ctx.fillStyle = BG_DARK;
  ctx.fillRect(0, 0, w, h);

  // Champion-kit gradient: heavier tint behind the centre podium,
  // fading to dark navy at the edges so the card has presence
  // without overwhelming the flags themselves.
  const cx = w * 0.5;
  const cy = h * 0.55;
  const radius = Math.max(w, h) * 0.9;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g.addColorStop(0, hexToRgba(accent, 0.38));
  g.addColorStop(0.5, hexToRgba(accent, 0.14));
  g.addColorStop(1, hexToRgba(BG_DARK, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Top + bottom edge fades for legibility of header/footer text.
  const topFade = ctx.createLinearGradient(0, 0, 0, h * 0.25);
  topFade.addColorStop(0, hexToRgba(BG_DARK, 0.65));
  topFade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = topFade;
  ctx.fillRect(0, 0, w, h * 0.25);

  const bottomFade = ctx.createLinearGradient(0, h * 0.65, 0, h);
  bottomFade.addColorStop(0, "rgba(0,0,0,0)");
  bottomFade.addColorStop(1, hexToRgba(BG_DARK, 0.7));
  ctx.fillStyle = bottomFade;
  ctx.fillRect(0, h * 0.65, w, h * 0.35);
}

async function paintHeader(
  ctx: SKRSContext2D,
  w: number,
  h: number,
  size: CanvasCardSize,
  input: BracketShareCardInput,
): Promise<void> {
  const padX = sizePad(size);
  const headerY = size === "landscape" ? 36 : 56;
  const avatarSize = size === "landscape" ? 64 : 80;

  // Avatar circle
  const avatarImg = await tryLoadAvatar(input.avatarUrl);
  drawCircularAvatar(ctx, avatarImg, padX, headerY, avatarSize);

  const handle = input.user.handle || "anonymous";
  const display = input.user.displayName?.trim() || null;
  const textX = padX + avatarSize + 18;

  // @handle (primary)
  ctx.fillStyle = INK_100;
  ctx.font = `700 ${size === "landscape" ? 24 : 30}px "DejaVu Sans"`;
  ctx.textBaseline = "top";
  ctx.fillText(`@${handle}`, textX, headerY + 6);

  // Display name (secondary)
  if (display) {
    ctx.fillStyle = INK_300;
    ctx.font = `400 ${size === "landscape" ? 16 : 20}px "DejaVu Sans"`;
    ctx.fillText(display, textX, headerY + (size === "landscape" ? 36 : 46));
  }

  // Tournament label, right-aligned eyebrow
  ctx.fillStyle = INK_500;
  ctx.font = `700 ${size === "landscape" ? 13 : 16}px "DejaVu Sans"`;
  ctx.textBaseline = "top";
  const tournament = (input.tournamentName || "World Cup 2026").toUpperCase();
  const tw = ctx.measureText(tournament).width;
  ctx.fillText(tournament, w - padX - tw, headerY + 10);
}

async function paintPodium(
  ctx: SKRSContext2D,
  w: number,
  h: number,
  size: CanvasCardSize,
  input: BracketShareCardInput,
): Promise<void> {
  const padX = sizePad(size);
  // Carve a horizontal band roughly centred vertically for the three
  // tiles. Landscape leans bigger flag heights; portrait stretches.
  const bandTop = size === "landscape" ? 130 : size === "portrait" ? 280 : 230;
  const bandBottom = h - (size === "landscape" ? 100 : 180);
  const bandHeight = bandBottom - bandTop;

  // Three columns: 2nd | 1st | 3rd. Centre is enlarged (1.18×).
  const innerW = w - padX * 2;
  const tileGap = size === "landscape" ? 20 : 28;
  const goldScale = 1.18;
  const sideScale = 1.0;
  const totalScaleUnits = sideScale + goldScale + sideScale;
  const baseTileW = (innerW - tileGap * 2) / totalScaleUnits;

  const tileW = {
    silver: baseTileW * sideScale,
    gold: baseTileW * goldScale,
    bronze: baseTileW * sideScale,
  };

  const silverX = padX;
  const goldX = silverX + tileW.silver + tileGap;
  const bronzeX = goldX + tileW.gold + tileGap;

  // Tile heights derive from content: medallion + flag + code text +
  // pill + name + padding. Per-size-preset type scale lives in
  // tileTypeScale(); we re-create it here to size the tile box.
  function contentHeight(tileWidth: number, medal: "gold" | "silver" | "bronze"): number {
    const ts = tileTypeScale(size, medal);
    const flagW = Math.round(tileWidth * ts.flagFraction);
    const flagH = flagW * (2 / 3);
    const pillH = Math.round(ts.pillPx * 1.9);
    const bottomPad = 30;
    return (
      ts.topPad +
      flagH +
      Math.round(ts.codePx * 0.85) +
      Math.round(ts.codePx * 0.55) +
      pillH +
      14 +
      ts.namePx +
      bottomPad
    );
  }
  const sideContent = Math.max(
    contentHeight(tileW.silver, "silver"),
    contentHeight(tileW.bronze, "bronze"),
  );
  const goldContent = contentHeight(tileW.gold, "gold");
  const tileH = Math.min(bandHeight, sideContent);
  const goldH = Math.min(bandHeight, goldContent);
  const trioCentreY = bandTop + bandHeight / 2;
  const baseline = trioCentreY + tileH / 2;
  const goldTop = baseline - goldH;
  const sideTop = baseline - tileH;

  const champion = input.champion;
  const silver = input.runnerUp ?? null;
  const bronze = input.thirdPlace ?? null;

  // Render order: bronze/silver behind, gold on top so the centre
  // shadow / glow doesn't get clipped by neighbours.
  if (silver) {
    await drawPodiumTile(ctx, {
      x: silverX,
      y: sideTop,
      w: tileW.silver,
      h: tileH,
      medal: "silver",
      team: silver,
      sizePreset: size,
    });
  }
  if (bronze) {
    await drawPodiumTile(ctx, {
      x: bronzeX,
      y: sideTop,
      w: tileW.bronze,
      h: tileH,
      medal: "bronze",
      team: bronze,
      sizePreset: size,
    });
  }
  await drawPodiumTile(ctx, {
    x: goldX,
    y: goldTop,
    w: tileW.gold,
    h: goldH,
    medal: "gold",
    team: champion,
    sizePreset: size,
  });
}

interface PodiumTileArgs {
  x: number;
  y: number;
  w: number;
  h: number;
  medal: "gold" | "silver" | "bronze";
  team: { code: string; name: string; kit?: { primary?: string | null } | null };
  sizePreset: CanvasCardSize;
}

/**
 * Type-scale per size preset. Portrait + square give each tile more
 * canvas to itself than landscape, so the team code + name fonts step
 * up proportionally and the card reads big on a phone screen.
 */
function tileTypeScale(size: CanvasCardSize, medal: "gold" | "silver" | "bronze") {
  const isGold = medal === "gold";
  if (size === "landscape") {
    return {
      codePx: isGold ? 48 : 40,
      namePx: isGold ? 20 : 18,
      pillPx: isGold ? 14 : 13,
      medallionR: isGold ? 22 : 18,
      flagFraction: isGold ? 0.78 : 0.74,
      topPad: isGold ? 72 : 64,
    };
  }
  if (size === "portrait") {
    return {
      codePx: isGold ? 76 : 60,
      namePx: isGold ? 26 : 22,
      pillPx: isGold ? 18 : 16,
      medallionR: isGold ? 28 : 22,
      flagFraction: isGold ? 0.78 : 0.74,
      topPad: isGold ? 92 : 80,
    };
  }
  // square
  return {
    codePx: isGold ? 64 : 52,
    namePx: isGold ? 22 : 20,
    pillPx: isGold ? 16 : 14,
    medallionR: isGold ? 24 : 20,
    flagFraction: isGold ? 0.78 : 0.74,
    topPad: isGold ? 80 : 72,
  };
}

async function drawPodiumTile(
  ctx: SKRSContext2D,
  args: PodiumTileArgs,
): Promise<void> {
  const { x, y, w, h, medal, team, sizePreset } = args;
  const medalColour =
    medal === "gold" ? GOLD : medal === "silver" ? SILVER : BRONZE;
  const ordinal = medal === "gold" ? "1ST" : medal === "silver" ? "2ND" : "3RD";
  const ts = tileTypeScale(sizePreset, medal);

  // Tile card
  const radius = 22;
  roundedRect(ctx, x, y, w, h, radius);
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, hexToRgba(BG_DARK_2, 0.92));
  grad.addColorStop(1, hexToRgba(BG_DARK, 0.92));
  ctx.fillStyle = grad;
  ctx.fill();

  // Medal-coloured border, thicker on gold
  ctx.lineWidth = medal === "gold" ? 4 : 2;
  ctx.strokeStyle = hexToRgba(medalColour, medal === "gold" ? 0.9 : 0.55);
  ctx.stroke();

  // Faint glow behind the gold tile to give it lift
  if (medal === "gold") {
    ctx.save();
    ctx.shadowColor = hexToRgba(medalColour, 0.45);
    ctx.shadowBlur = 32;
    ctx.shadowOffsetY = 0;
    roundedRect(ctx, x, y, w, h, radius);
    ctx.strokeStyle = hexToRgba(medalColour, 0.0);
    ctx.stroke();
    ctx.restore();
  }

  // Medal medallion at the top: a filled circle in the medal colour
  // with a Roman numeral (I / II / III) overlay. We dropped the emoji
  // cup glyph route because Noto Color Emoji renders as a flat tofu
  // box on most @napi-rs/canvas builds — the medallion is identical
  // visual semantics and survives every renderer.
  const medallionR = ts.medallionR;
  const medallionCx = x + w / 2;
  const medallionCy = y + 12 + medallionR;
  // Outer halo
  ctx.beginPath();
  ctx.arc(medallionCx, medallionCy, medallionR + 4, 0, Math.PI * 2);
  ctx.fillStyle = hexToRgba(medalColour, 0.18);
  ctx.fill();
  // Solid medallion
  ctx.beginPath();
  ctx.arc(medallionCx, medallionCy, medallionR, 0, Math.PI * 2);
  ctx.fillStyle = medalColour;
  ctx.fill();
  // Numeral
  ctx.fillStyle = BG_DARK;
  ctx.font = `900 ${Math.round(medallionR * 0.85)}px "DejaVu Sans"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const numeral = medal === "gold" ? "I" : medal === "silver" ? "II" : "III";
  ctx.fillText(numeral, medallionCx, medallionCy + 1);

  // Flag image (centered) — scales with tile width so portrait/square
  // tiles have a flag that fills the available room rather than
  // hugging a 200px cap. Gold tile gets a slightly bigger flag.
  const flagW = Math.round(w * ts.flagFraction);
  const flagH = flagW * (2 / 3);
  const flagX = x + (w - flagW) / 2;
  const flagY = y + ts.topPad;

  try {
    const img = await loadFlagImage({
      code: team.code,
      width: Math.round(flagW),
      placeholderColour: sanitiseHex(team.kit?.primary) ?? undefined,
    });
    ctx.save();
    // Slight rounded clip on the flag
    roundedRect(ctx, flagX, flagY, flagW, flagH, 8);
    ctx.clip();
    ctx.drawImage(img, flagX, flagY, flagW, flagH);
    ctx.restore();

    // Inner shadow/highlight border around the flag for definition
    roundedRect(ctx, flagX, flagY, flagW, flagH, 8);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } catch {
    // Fall back to nothing if even the placeholder fails
  }

  // Team 3-letter code (BIG)
  ctx.fillStyle = WHITE;
  ctx.font = `900 ${ts.codePx}px "DejaVu Sans"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const codeY = flagY + flagH + Math.round(ts.codePx * 0.85);
  ctx.fillText(team.code.toUpperCase(), x + w / 2, codeY);

  // Ordinal pill (1ST / 2ND / 3RD)
  const pillW = Math.round(ts.pillPx * (medal === "gold" ? 5.4 : 4.9));
  const pillH = Math.round(ts.pillPx * 1.9);
  const pillX = x + (w - pillW) / 2;
  const pillY = codeY + Math.round(ts.codePx * 0.55);
  roundedRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fillStyle = hexToRgba(medalColour, 0.18);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(medalColour, 0.6);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = medalColour;
  ctx.font = `700 ${ts.pillPx}px "DejaVu Sans"`;
  ctx.textBaseline = "middle";
  ctx.fillText(ordinal, x + w / 2, pillY + pillH / 2 + 1);

  // Team name underneath, slightly muted
  ctx.fillStyle = INK_300;
  ctx.font = `600 ${ts.namePx}px "DejaVu Sans"`;
  ctx.textBaseline = "top";
  // Truncate if too long for tile width
  const name = truncateToWidth(ctx, team.name, w - 24);
  ctx.fillText(name, x + w / 2, pillY + pillH + 14);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

async function paintFooter(
  ctx: SKRSContext2D,
  w: number,
  h: number,
  size: CanvasCardSize,
  input: BracketShareCardInput,
  accent: string,
): Promise<void> {
  const padX = sizePad(size);
  const footerY = h - (size === "landscape" ? 58 : 90);

  // Predict-yours CTA line
  ctx.fillStyle = INK_300;
  ctx.font = `600 ${size === "landscape" ? 18 : 22}px "DejaVu Sans"`;
  ctx.textBaseline = "middle";
  ctx.fillText("Predict yours at ", padX, footerY + 14);
  const ctaTextW = ctx.measureText("Predict yours at ").width;

  // Share URL in accent
  const guid = (input.shareGuid ?? "").trim();
  const url = guid ? `${SHARE_BASE_URL}${guid}` : "play.tournamental.com";
  ctx.fillStyle = accent;
  ctx.font = `700 ${size === "landscape" ? 18 : 22}px "DejaVu Sans"`;
  ctx.fillText(url, padX + ctaTextW, footerY + 14);

  // Tournamental wordmark, bottom-right
  ctx.fillStyle = INK_500;
  ctx.font = `700 ${size === "landscape" ? 16 : 20}px "DejaVu Sans"`;
  ctx.textAlign = "right";
  ctx.fillText(BRAND_WORDMARK, w - padX - (guid ? 92 : 0), footerY + 14);
  ctx.textAlign = "left";

  // QR code, only when we have a guid worth scanning
  if (guid) {
    try {
      const qrSize = size === "landscape" ? 60 : 76;
      const qrDataUrl = await QRCode.toDataURL(`https://${SHARE_BASE_URL}${guid}`, {
        margin: 0,
        errorCorrectionLevel: "M",
        color: { dark: WHITE, light: "#00000000" },
        width: qrSize * 2,
      });
      const img = await loadImage(qrDataUrl);
      ctx.drawImage(img, w - padX - qrSize, footerY - qrSize / 2 + 14, qrSize, qrSize);
    } catch {
      // ignore; the URL text in the footer is the fallback
    }
  }
}

function drawCircularAvatar(
  ctx: SKRSContext2D,
  img: Image | null,
  x: number,
  y: number,
  size: number,
): void {
  // Backdrop ring (always drawn so the placeholder reads cleanly)
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.stroke();
  ctx.restore();

  if (img) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, x, y, size, size);
    ctx.restore();
    return;
  }

  // Silhouette fallback
  ctx.save();
  ctx.fillStyle = "rgba(148, 163, 184, 0.55)";
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size * 0.4, size * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size * 1.05, size * 0.45, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

async function tryLoadAvatar(url: string | null | undefined): Promise<Image | null> {
  if (!url) return null;
  try {
    // Support same-origin paths (e.g. "/avatars/x.webp") by joining
    // to play.tournamental.com — the renderer runs server-side and
    // can fetch absolute URLs only.
    const full =
      /^https?:\/\//i.test(url) ? url : `https://play.tournamental.com${url}`;
    const res = await fetch(full);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return await loadImage(buf);
  } catch {
    return null;
  }
}

function roundedRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function sizePad(size: CanvasCardSize): number {
  if (size === "landscape") return 48;
  if (size === "square") return 56;
  return 60;
}

function truncateToWidth(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cur = text;
  while (cur.length > 1 && ctx.measureText(cur + "…").width > maxWidth) {
    cur = cur.slice(0, -1);
  }
  return cur + "…";
}

function sanitiseHex(s: string | null | undefined): string | null {
  if (!s) return null;
  const v = s.trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(v)) return v.startsWith("#") ? v : `#${v}`;
  if (/^#?[0-9a-fA-F]{3}$/.test(v)) {
    const r = v.replace("#", "");
    return `#${r[0]}${r[0]}${r[1]}${r[1]}${r[2]}${r[2]}`;
  }
  return null;
}

function hexToRgba(hex: string, alpha: number): string {
  const v = hex.replace("#", "");
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
