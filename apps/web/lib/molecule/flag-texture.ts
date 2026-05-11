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

const TEX_WIDTH = 512;
const TEX_HEIGHT = 256;
const FLAG_WIDTH = 384; // 3:2 aspect → height 256
const FLAG_HEIGHT = 256;
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
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  const entry: CachedEntry = { texture, canvas, ready: false };
  cache.set(key, entry);

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    try {
      paintFlagOnto(canvas, img);
      texture.needsUpdate = true;
      entry.ready = true;
    } catch {
      // ignore — fallback canvas stays in place.
    }
  };
  img.onerror = () => {
    // Fallback stays in place — accent-coloured flat colour.
  };
  // SVG files in /public are served as image/svg+xml.
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
