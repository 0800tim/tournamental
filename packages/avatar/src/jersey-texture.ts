/**
 * Procedural jersey texture generator.
 *
 * Per docs/07-avatars-and-assets.md: paint a 512x512 canvas with the kit
 * primary, a horizontal secondary stripe across the chest, and the player's
 * number in large text on the back panel. Cache the result by
 * (teamId, number, isGK) — at most 22 unique textures per match.
 *
 * The function is environment-agnostic: it works in the browser (HTML5
 * Canvas) and in Node when a polyfilled `document.createElement("canvas")`
 * is available (e.g. via `node-canvas` in tests). When a non-DOM canvas
 * factory is needed, callers can pass `canvasFactory` to override.
 */
import * as THREE from "three";
import type { Kit } from "@tournamental/spec";

export interface MakeJerseyTextureOptions {
  /** Override canvas creation (useful for SSR / tests). */
  canvasFactory?: () => HTMLCanvasElement;
  /** Override texture constructor for non-three.js test contexts. */
  textureFactory?: (canvas: HTMLCanvasElement) => THREE.CanvasTexture;
}

const DEFAULT_TEXT_COLOUR = "#FFFFFF";
const TEXTURE_SIZE = 512;
const STRIPE_Y = 200;
const STRIPE_H = 40;
const NUMBER_FONT = "bold 280px Inter, Arial, sans-serif";
const NUMBER_BASELINE_Y = 384;

function defaultCanvasFactory(): HTMLCanvasElement {
  if (typeof document === "undefined") {
    throw new Error(
      "[@vtorn/avatar] makeJerseyTexture requires a DOM `document` or a `canvasFactory` override."
    );
  }
  return document.createElement("canvas");
}

/**
 * Produce a `THREE.CanvasTexture` for a player's torso material. Pure
 * function — no caching here. Use {@link JerseyTextureCache} for the
 * shared per-match cache layer.
 */
export function makeJerseyTexture(
  kit: Kit,
  number: number,
  isGK = false,
  options: MakeJerseyTextureOptions = {}
): THREE.CanvasTexture {
  const c = (options.canvasFactory ?? defaultCanvasFactory)();
  c.width = c.height = TEXTURE_SIZE;
  const ctx = c.getContext("2d");
  if (!ctx) {
    throw new Error("[@vtorn/avatar] failed to acquire 2d context for jersey texture.");
  }

  const k = isGK && kit.goalkeeper ? kit.goalkeeper : kit;

  ctx.fillStyle = k.primary;
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  ctx.fillStyle = k.secondary;
  ctx.fillRect(0, STRIPE_Y, TEXTURE_SIZE, STRIPE_H);

  ctx.fillStyle = k.text ?? DEFAULT_TEXT_COLOUR;
  ctx.font = NUMBER_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(number), TEXTURE_SIZE / 2, NUMBER_BASELINE_Y);

  if (options.textureFactory) {
    return options.textureFactory(c);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Build a stable cache key for a jersey texture. */
export function jerseyCacheKey(teamId: string, number: number, isGK: boolean): string {
  return `${teamId}|${number}|${isGK ? "gk" : "out"}`;
}

/**
 * Per-match jersey-texture cache. At most ~44 entries (two squads of 22)
 * for a single match. Caller owns disposal — `dispose()` releases all GPU
 * textures held by the cache.
 */
export class JerseyTextureCache {
  private readonly entries = new Map<string, THREE.CanvasTexture>();

  constructor(private readonly options: MakeJerseyTextureOptions = {}) {}

  get(teamId: string, kit: Kit, number: number, isGK = false): THREE.CanvasTexture {
    const key = jerseyCacheKey(teamId, number, isGK);
    const cached = this.entries.get(key);
    if (cached) return cached;
    const tex = makeJerseyTexture(kit, number, isGK, this.options);
    this.entries.set(key, tex);
    return tex;
  }

  has(teamId: string, number: number, isGK = false): boolean {
    return this.entries.has(jerseyCacheKey(teamId, number, isGK));
  }

  size(): number {
    return this.entries.size;
  }

  dispose(): void {
    for (const tex of this.entries.values()) {
      tex.dispose();
    }
    this.entries.clear();
  }
}
