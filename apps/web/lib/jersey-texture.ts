import * as THREE from "three";
import type { Kit } from "@vtorn/spec";

/**
 * Generate a CanvasTexture for a player's torso material.
 *
 * Implementation matches doc 07: solid primary fill, secondary chest stripe,
 * jersey number painted on the back. We cache the resulting texture by
 * `(kit hash, number, isGK)` because at most 22 unique textures exist per
 * match and rebuilding a 512×512 canvas per frame would be wasteful.
 *
 * Falls back to a 1×1 transparent texture on the server (no DOM canvas).
 */
const cache = new Map<string, THREE.CanvasTexture>();

function kitKey(kit: Kit, number: number, isGK: boolean): string {
  const k = isGK && kit.goalkeeper ? kit.goalkeeper : kit;
  return `${k.primary}|${k.secondary}|${k.text ?? "#FFFFFF"}|${number}|${isGK ? "gk" : "out"}`;
}

export function makeJerseyTexture(kit: Kit, number: number, isGK = false): THREE.Texture {
  if (typeof document === "undefined") {
    return new THREE.Texture();
  }
  const key = kitKey(kit, number, isGK);
  const cached = cache.get(key);
  if (cached) return cached;

  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d");
  if (!ctx) return new THREE.Texture();

  const k = isGK && kit.goalkeeper ? kit.goalkeeper : kit;
  ctx.fillStyle = k.primary;
  ctx.fillRect(0, 0, 512, 512);

  ctx.fillStyle = k.secondary;
  ctx.fillRect(0, 200, 512, 40);

  ctx.fillStyle = k.text ?? "#FFFFFF";
  ctx.font = "bold 280px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(number), 256, 384);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

export function clearJerseyTextureCache(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
