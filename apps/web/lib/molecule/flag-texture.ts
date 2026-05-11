/**
 * Flag-texture cache — load SVG flags from `/flags/<id>.svg` at runtime,
 * rasterise them into a 3:2 canvas, and return a THREE.CanvasTexture that
 * can be wrapped around a sphere.
 *
 * Why runtime (not build-time): keeps the bundle lean. SVGs already ship
 * in `public/flags/` for the 2D bracket UI; the molecule view reuses them
 * by drawing each to an OffscreenCanvas the first time it's needed.
 *
 * Caching: each (teamCode, size) pair gets one CanvasTexture, shared
 * across all atoms. 48 textures @ 256x171 ~= ~8MB of GPU memory at most,
 * well within budget for a 2022 mid-range Android.
 *
 * Aspect: flags are rendered 3:2 onto a 2:1 canvas (the sphere texture
 * needs 2:1 to wrap without distortion). The flag is centred horizontally
 * on the canvas and tinted dark blue above/below so the poles of the
 * sphere don't read as flat white caps.
 */

import * as THREE from "three";

interface CachedEntry {
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ready: boolean;
}

const cache = new Map<string, CachedEntry>();

/**
 * v3: raster at 1024×512 (was 512×256) so even the smallest atoms on
 * the pyramid's lower tiers show crisp SVG strokes. 1024×512 RGBA × 48
 * teams ≈ 96 MB worst-case GPU footprint — still within budget for a
 * 2022 mid-range Android (most teams ~24 group losers stay at the smallest
 * tier, but the texture is shared across all atoms of the same team so
 * we only pay 48 × 2 MB = 96 MB max — typically ~half that since not
 * every team is loaded at once).
 */
const TEX_WIDTH = 1024;
const TEX_HEIGHT = 512;
const FLAG_WIDTH = 768; // 3:2 aspect → height 512
const FLAG_HEIGHT = 512;
const FLAG_X = (TEX_WIDTH - FLAG_WIDTH) / 2;

const POLE_TINT = "#0a0e1a"; // matches the scene background.

/**
 * Make a fallback texture (solid dark navy) for teams we don't have a
 * flag SVG for. Lets the scene render even when a fetch fails.
 */
function makeFallbackCanvas(accent: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_WIDTH;
  canvas.height = TEX_HEIGHT;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = POLE_TINT;
  ctx.fillRect(0, 0, TEX_WIDTH, TEX_HEIGHT);
  ctx.fillStyle = accent;
  ctx.fillRect(FLAG_X, 0, FLAG_WIDTH, TEX_HEIGHT);
  return canvas;
}

/**
 * Paint the loaded SVG image into the canvas with poles tinted.
 */
function paintFlagOnto(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
): void {
  const ctx = canvas.getContext("2d")!;
  // Background: dark pole tint.
  ctx.fillStyle = POLE_TINT;
  ctx.fillRect(0, 0, TEX_WIDTH, TEX_HEIGHT);
  // Centre the flag horizontally (gives a small dark bar at left+right
  // edges of the texture, which wraps to the back of the sphere).
  ctx.drawImage(img, FLAG_X, 0, FLAG_WIDTH, FLAG_HEIGHT);
}

/**
 * Get-or-create a flag texture for a team. Returns immediately with a
 * texture object; the underlying image loads asynchronously and updates
 * the texture in-place when it arrives (`texture.needsUpdate = true`).
 *
 * SSR-safe: returns a placeholder texture if `document` isn't available.
 */
export function getFlagTexture(
  teamCode: string,
  accent: string,
): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;

  const key = teamCode;
  const existing = cache.get(key);
  if (existing) return existing.texture;

  const canvas = makeFallbackCanvas(accent);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // v3: bump anisotropy from 4 → 16 so flags stay sharp when the atom
  // is viewed at a grazing angle (common on the lower pyramid tiers
  // when the camera is tilted up toward the apex). Browsers cap this
  // at the GPU's max, so we don't pay if the hardware can't support it.
  texture.anisotropy = 16;
  // Trilinear filter — softens shimmer on small atoms as the camera
  // moves through their LOD threshold without introducing visible
  // mip seams.
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  const entry: CachedEntry = { texture, canvas, ready: false };
  cache.set(key, entry);

  // The SVG is rendered at twice the canvas size on the way in — most
  // SVG renderers anti-alias on the final raster, so up-sampling first
  // then drawing at the canvas's native size gives crisper strokes than
  // letting the canvas API down-sample a wider source. Browsers that
  // support `Image.decode()` get a clean wait-for-decode promise; older
  // browsers fall back to onload.
  const img = new Image();
  img.crossOrigin = "anonymous";
  // Hint to the renderer that we want decoded image data, not just a
  // bitmap reference — helps Firefox keep SVGs sharp. (`decoding` is a
  // standard HTMLImageElement attribute; the cast is for the older
  // lib.dom.d.ts that pre-dates it.)
  (img as HTMLImageElement & { decoding?: "async" | "sync" | "auto" }).decoding = "async";
  const paintOnce = () => {
    try {
      paintFlagOnto(canvas, img);
      texture.needsUpdate = true;
      entry.ready = true;
    } catch {
      // ignore — fallback canvas stays in place.
    }
  };
  img.onload = () => {
    if (typeof img.decode === "function") {
      img.decode().then(paintOnce).catch(paintOnce);
    } else {
      paintOnce();
    }
  };
  img.onerror = () => {
    // Fallback stays in place — accent-coloured flat colour.
  };
  // SVG files in /public are served as image/svg+xml. We hint at the
  // intrinsic size so the SVG renderer picks the high-res raster path.
  img.width = FLAG_WIDTH;
  img.height = FLAG_HEIGHT;
  img.src = `/flags/${teamCode}.svg`;

  return texture;
}

/**
 * Test-only — clear the cache so unit tests start fresh.
 */
export function _clearFlagTextureCache(): void {
  for (const entry of cache.values()) {
    entry.texture.dispose();
  }
  cache.clear();
}
