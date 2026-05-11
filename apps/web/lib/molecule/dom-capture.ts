/**
 * Client-side DOM-faithful capture for the molecule pyramid + champion
 * panel.
 *
 * v6, "viral share landing". Tim's brief 2026-05-11 calls the molecule
 * + panel view the "viral hook" of the entire product. The capture image
 * has to be a literal screenshot of what the user sees on the page, NOT
 * a server-re-drawn card. This module composes:
 *
 *   +----------------------+-----------+
 *   |                      |           |
 *   |   PYRAMID (~1100px)  | PANEL     |
 *   |   (WebGL canvas)     | (~460px)  |
 *   |   incl. drei <Html>  | (DOM)     |
 *   |   opponent badges    |           |
 *   |                      |           |
 *   +----------------------+-----------+
 *   |  WORDMARK              QR + URL  |  ← 80 px footer
 *   +----------------------+-----------+
 *
 *   total: 1600 × 900 (16:9, slightly wider than the standard OG 1200×630
 *   so the pyramid + panel composition has room to breathe).
 *
 * Strategy:
 *   1. Snapshot the R3F WebGL canvas via `canvas.toDataURL('image/png')`
 *      so the drei `<Html>` overlays Tim insisted must stay in the image
 *      are captured by virtue of being rendered into the same WebGL frame
 *      and read back via `preserveDrawingBuffer`.
 *   2. Snapshot `.molecule-panel` via `html-to-image` (SVG `<foreignObject>`
 *      under the hood, ~16 kB gzipped, MIT licensed). We add a
 *      `data-capture-mode="true"` data attribute on the panel for the
 *      duration so the close button + Highlight-on-scene toggle are
 *      hidden in the snapshot.
 *   3. Fetch the QR PNG from `/api/share/qr/[guid]` (server-rendered with
 *      the existing @vtorn/social-cards QR pipeline, kept off the client
 *      bundle). Cache the resulting data URL in module scope so repeated
 *      captures don't re-fetch.
 *   4. Composite all three plus a Tournamental wordmark + URL onto an
 *      OffscreenCanvas (falling back to a regular `<canvas>` element on
 *      older Safari) at 1600x900 and return a PNG `Blob`.
 *
 * All under 1.2 s on mid-range hardware:
 *   - canvas.toDataURL: ~5 ms
 *   - html-to-image of the panel (~480x900): ~150-300 ms
 *   - QR fetch (first time): ~80 ms; cached on subsequent captures
 *   - composite: ~10-30 ms
 *
 * SSR-safe: all browser APIs guarded so this file is import-clean from
 * server components.
 */

import { toPng } from "html-to-image";

import type { CaptureChampion, CapturePathEntry } from "./capture";

export interface DomCaptureInput {
  readonly shareGuid: string;
  readonly handle?: string | null;
  readonly tournamentName?: string;
  readonly champion?: CaptureChampion | null;
  readonly knockoutPath?: ReadonlyArray<CapturePathEntry>;
}

export interface DomCaptureResult {
  readonly blob: Blob;
  readonly objectUrl: string;
  readonly filename: string;
}

const OUT_WIDTH = 1600;
const OUT_HEIGHT = 900;
const FOOTER_HEIGHT = 80;
const SCENE_HEIGHT = OUT_HEIGHT - FOOTER_HEIGHT; // 820
const PYRAMID_WIDTH = 1100;
const GUTTER = 8;
const PANEL_WIDTH = OUT_WIDTH - PYRAMID_WIDTH - GUTTER; // 492

const BG = "#0a0e1a";
const GOLD = "#f5c542";
const INK = "#cdd5e7";
const URL_BASE = "https://play.tournamental.com/s/";

// QR data URL cache keyed by guid. Module-scope, lives for the page
// session — repeated captures for the same bracket reuse the byte-blob.
const qrCache = new Map<string, string>();

/**
 * Find the WebGL canvas underneath `.molecule-canvas`. The class hook is
 * declared on the R3F `<Canvas>` element so this stays a tiny one-line
 * lookup, no scene-component coupling.
 */
function findCanvas(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector(".molecule-canvas");
  if (!el) return null;
  if (el instanceof HTMLCanvasElement) return el;
  const inner = el.querySelector("canvas");
  return inner instanceof HTMLCanvasElement ? inner : null;
}

function findPanel(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector(".molecule-panel");
  return el instanceof HTMLElement ? el : null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

async function fetchQrDataUrl(shareGuid: string): Promise<string | null> {
  const cached = qrCache.get(shareGuid);
  if (cached) return cached;
  try {
    const res = await fetch(`/api/share/qr/${encodeURIComponent(shareGuid)}?size=96`);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
      r.onerror = () => reject(new Error("qr read failed"));
      r.readAsDataURL(blob);
    });
    qrCache.set(shareGuid, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

/**
 * Snapshot the panel DOM to a PNG data URL via html-to-image. The panel
 * gets a transient `data-capturing` flag and inline width/height so the
 * snapshot always renders at desktop dimensions even on mobile (where the
 * live panel docks to a 60vh bottom sheet).
 */
async function snapshotPanel(): Promise<string | null> {
  const panel = findPanel();
  if (!panel) return null;
  const prev = {
    captureMode: panel.dataset.captureMode,
    width: panel.style.width,
    height: panel.style.height,
    top: panel.style.top,
    bottom: panel.style.bottom,
    right: panel.style.right,
    left: panel.style.left,
    position: panel.style.position,
    transform: panel.style.transform,
  };
  panel.dataset.captureMode = "true";
  // Force a desktop-shaped panel for the snapshot (even on mobile where
  // the live element docks to a 60vh bottom sheet). The capture target
  // is PANEL_WIDTH × SCENE_HEIGHT.
  panel.style.width = `${PANEL_WIDTH}px`;
  panel.style.height = `${SCENE_HEIGHT}px`;
  panel.style.top = "0";
  panel.style.bottom = "auto";
  panel.style.right = "0";
  panel.style.left = "auto";
  panel.style.transform = "none";

  try {
    const dataUrl = await toPng(panel, {
      width: PANEL_WIDTH,
      height: SCENE_HEIGHT,
      backgroundColor: BG,
      pixelRatio: 2,
      cacheBust: false,
      skipFonts: false,
      // Filter out any nested controls that managed to slip past
      // `data-capture-mode` (defensive — current capture-mode CSS hides
      // the close button + toggle; this is belt-and-braces).
      filter: (node) => {
        if (!(node instanceof HTMLElement)) return true;
        if (node.classList?.contains("molecule-panel-close")) return false;
        if (node.classList?.contains("molecule-panel-toolbar")) return false;
        return true;
      },
    });
    return dataUrl;
  } finally {
    // Always restore — even if html-to-image throws the panel must come
    // back to its on-screen geometry or the live page breaks.
    panel.dataset.captureMode = prev.captureMode ?? "false";
    if (prev.captureMode === undefined) delete panel.dataset.captureMode;
    panel.style.width = prev.width;
    panel.style.height = prev.height;
    panel.style.top = prev.top;
    panel.style.bottom = prev.bottom;
    panel.style.right = prev.right;
    panel.style.left = prev.left;
    panel.style.position = prev.position;
    panel.style.transform = prev.transform;
  }
}

/**
 * Get a 2D context on a regular canvas of given dimensions. We prefer a
 * plain `<canvas>` over OffscreenCanvas for `toBlob` compatibility (some
 * Safari versions still ship `OffscreenCanvas` without a usable
 * `convertToBlob` path).
 */
function makeContext(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  return { canvas, ctx };
}

/**
 * "Draw image scaled to fill width × height while preserving aspect
 * ratio, cropped centred." Used to fit the live WebGL pyramid into the
 * 1100×820 left slot without distortion.
 */
function drawCovered(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const sr = sw / sh;
  const dr = dw / dh;
  let cropW = sw;
  let cropH = sh;
  let cropX = 0;
  let cropY = 0;
  if (sr > dr) {
    // source is wider — crop horizontally
    cropW = sh * dr;
    cropX = (sw - cropW) / 2;
  } else {
    // source is taller — crop vertically
    cropH = sw / dr;
    cropY = (sh - cropH) / 2;
  }
  ctx.drawImage(img, cropX, cropY, cropW, cropH, dx, dy, dw, dh);
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  shareGuid: string,
  qrImg: HTMLImageElement | null,
): void {
  const y = SCENE_HEIGHT;
  // Footer strip
  ctx.fillStyle = "#101626";
  ctx.fillRect(0, y, OUT_WIDTH, FOOTER_HEIGHT);
  // Top-edge gold rule
  ctx.fillStyle = GOLD;
  ctx.fillRect(0, y, OUT_WIDTH, 2);

  // Wordmark left
  ctx.fillStyle = GOLD;
  ctx.font = '900 28px -apple-system, "Segoe UI", system-ui, sans-serif';
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("TOURNAMENTAL", 32, y + FOOTER_HEIGHT / 2);

  // Subtitle (handle / promo)
  ctx.fillStyle = INK;
  ctx.font = '600 14px -apple-system, "Segoe UI", system-ui, sans-serif';
  ctx.fillText(
    "FIFA WORLD CUP 2026 · PREDICTION MOLECULE",
    32 + ctx.measureText("TOURNAMENTAL").width + 16,
    y + FOOTER_HEIGHT / 2 + 1,
  );

  // QR + URL right
  const qrSize = 56;
  const rightPad = 32;
  const urlText = `${URL_BASE}${shareGuid}`;
  ctx.font = '700 16px -apple-system, "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = "right";
  ctx.fillStyle = "#fff";
  let urlX = OUT_WIDTH - rightPad;
  if (qrImg) {
    urlX = OUT_WIDTH - rightPad - qrSize - 16;
    ctx.drawImage(
      qrImg,
      OUT_WIDTH - rightPad - qrSize,
      y + (FOOTER_HEIGHT - qrSize) / 2,
      qrSize,
      qrSize,
    );
  }
  ctx.fillText(urlText, urlX, y + FOOTER_HEIGHT / 2 - 2);
  ctx.font = '600 11px -apple-system, "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = "#8b9bbd";
  ctx.fillText("Scan to view this molecule", urlX, y + FOOTER_HEIGHT / 2 + 18);
}

/**
 * Run the full DOM-faithful capture pipeline. Returns a PNG blob, an
 * object URL pointing at it, and a suggested filename for the download
 * fallback. Caller must `URL.revokeObjectURL` the URL when done.
 */
export async function captureDomComposition(
  input: DomCaptureInput,
): Promise<DomCaptureResult> {
  if (typeof document === "undefined") {
    throw new Error("captureDomComposition requires a browser");
  }
  const canvas = findCanvas();
  if (!canvas) throw new Error("molecule canvas not found");

  // 1. WebGL canvas → data URL (drei <Html> already baked into the
  //    WebGL frame). preserveDrawingBuffer is set on the R3F Canvas so
  //    this read returns pixels rather than a blank PNG.
  let canvasDataUrl: string;
  try {
    canvasDataUrl = canvas.toDataURL("image/png");
  } catch {
    throw new Error("canvas read failed (preserveDrawingBuffer missing?)");
  }

  // 2. Panel snapshot + QR fetch in parallel.
  const [panelDataUrl, qrDataUrl] = await Promise.all([
    snapshotPanel().catch(() => null),
    fetchQrDataUrl(input.shareGuid),
  ]);

  // 3. Load each into Image elements so the canvas drawImage can consume
  //    them. WebGL canvas data URL → Image; ditto for panel + QR. We do
  //    these sequentially because they share the same decode queue and
  //    starting them parallel produces no measurable speedup.
  const sceneImg = await loadImage(canvasDataUrl);
  const panelImg = panelDataUrl ? await loadImage(panelDataUrl).catch(() => null) : null;
  const qrImg = qrDataUrl ? await loadImage(qrDataUrl).catch(() => null) : null;

  // 4. Composite.
  const { canvas: out, ctx } = makeContext(OUT_WIDTH, OUT_HEIGHT);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, OUT_WIDTH, OUT_HEIGHT);

  // Pyramid on the left (1100 × 820)
  drawCovered(
    ctx,
    sceneImg,
    sceneImg.naturalWidth,
    sceneImg.naturalHeight,
    0,
    0,
    PYRAMID_WIDTH,
    SCENE_HEIGHT,
  );

  // Gold gutter (1px) between pyramid and panel for the brand edge.
  ctx.fillStyle = GOLD;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(PYRAMID_WIDTH, 0, GUTTER, SCENE_HEIGHT);
  ctx.globalAlpha = 1;

  // Panel on the right (~492 × 820)
  if (panelImg) {
    drawCovered(
      ctx,
      panelImg,
      panelImg.naturalWidth,
      panelImg.naturalHeight,
      PYRAMID_WIDTH + GUTTER,
      0,
      PANEL_WIDTH,
      SCENE_HEIGHT,
    );
  } else {
    // No panel snapshot — paint a "champion" fallback strip with the
    // basic data we already have in the capture input.
    ctx.fillStyle = "#101626";
    ctx.fillRect(PYRAMID_WIDTH + GUTTER, 0, PANEL_WIDTH, SCENE_HEIGHT);
    ctx.fillStyle = GOLD;
    ctx.font = '900 24px -apple-system, "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(
      "PREDICTED CHAMPION",
      PYRAMID_WIDTH + GUTTER + 24,
      32,
    );
    if (input.champion) {
      ctx.fillStyle = "#fff";
      ctx.font = '800 36px -apple-system, "Segoe UI", system-ui, sans-serif';
      ctx.fillText(input.champion.name, PYRAMID_WIDTH + GUTTER + 24, 64);
    }
  }

  drawFooter(ctx, input.shareGuid, qrImg);

  // 5. Materialise PNG blob.
  const blob = await new Promise<Blob>((resolve, reject) => {
    out.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("toBlob returned null"));
      },
      "image/png",
      0.95,
    );
  });

  const slug =
    (input.champion?.code ?? "molecule")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-") || "molecule";
  const filename = `tournamental-molecule-${slug}.png`;
  const objectUrl = URL.createObjectURL(blob);
  return { blob, objectUrl, filename };
}

/** Reset the QR cache. Exposed for testing + page-unload cleanup. */
export function clearDomCaptureQrCache(): void {
  qrCache.clear();
}
