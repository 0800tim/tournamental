/**
 * Billboard face component.
 *
 * Renders a player's face as a flat 2D quad that always faces the camera
 * (a "billboard"). When `faceUri` is provided we load the image as a
 * texture; otherwise we fall back to an initials disc using kit colours,
 * matching the failure mode in docs/07-avatars-and-assets.md.
 */
import * as React from "react";
import * as THREE from "three";
import type { Kit } from "@vtorn/spec";

export interface BillboardFaceProps {
  /** Optional remote image (PNG with transparent background recommended). */
  faceUri?: string;
  /** Kit used for the initials-disc fallback background. */
  kit: Kit;
  /** Display initials, derived from the player's name client-side. */
  initials: string;
  /** World-space size in metres. */
  size?: number;
  /** Local-space y offset (head height above the body's origin). */
  yOffset?: number;
}

const DEFAULT_SIZE = 0.32;
const DEFAULT_Y_OFFSET = 1.78;

/**
 * Hook: load `faceUri` into a `THREE.Texture`. Falls back to `null` until
 * the load resolves (or fails). Loader is shared across components.
 */
function useFaceTexture(faceUri?: string): THREE.Texture | null {
  const [texture, setTexture] = React.useState<THREE.Texture | null>(null);
  React.useEffect(() => {
    if (!faceUri) {
      setTexture(null);
      return;
    }
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      faceUri,
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        setTexture(tex);
      },
      undefined,
      () => {
        // Failure → fall back to initials. Mirrors doc 07 failure mode.
        if (!cancelled) setTexture(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [faceUri]);
  return texture;
}

function makeInitialsTexture(initials: string, kit: Kit): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  // Disc background.
  ctx.fillStyle = kit.primary;
  ctx.beginPath();
  ctx.arc(128, 128, 124, 0, Math.PI * 2);
  ctx.fill();

  // Ring.
  ctx.strokeStyle = kit.secondary;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(128, 128, 120, 0, Math.PI * 2);
  ctx.stroke();

  // Initials.
  ctx.fillStyle = kit.text ?? "#FFFFFF";
  ctx.font = "bold 110px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initials.slice(0, 2).toUpperCase(), 128, 142);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Compute initials from a player's display name. e.g. "Lionel Messi" → "LM".
 * Exported for the renderer so it stays consistent with the disc fallback.
 */
export function deriveInitials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  const first = parts[0]![0] ?? "";
  const last = parts[parts.length - 1]![0] ?? "";
  return (first + last).toUpperCase();
}

/**
 * `<BillboardFace />` — a camera-facing quad parented at head height.
 *
 * Designed to be dropped inside a player group; it positions itself
 * locally and uses three.js's sprite-style billboard so it tracks any
 * active camera in the scene.
 */
export const BillboardFace: React.FC<BillboardFaceProps> = ({
  faceUri,
  kit,
  initials,
  size = DEFAULT_SIZE,
  yOffset = DEFAULT_Y_OFFSET,
}) => {
  const remoteTexture = useFaceTexture(faceUri);
  const initialsTexture = React.useMemo(
    () => makeInitialsTexture(initials, kit),
    // Kit primary/secondary/text are the only inputs that change the disc.
    [initials, kit.primary, kit.secondary, kit.text]
  );

  React.useEffect(
    () => () => {
      initialsTexture?.dispose();
    },
    [initialsTexture]
  );

  const texture = remoteTexture ?? initialsTexture;
  if (!texture) return null;

  // Use a sprite for cheap always-faces-camera behaviour. Renderer can
  // wrap with a <group> if it wants to apply a y offset relative to the
  // body's origin; we honour `yOffset` here as a convenience default.
  const material = React.useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      }),
    [texture]
  );

  React.useEffect(
    () => () => {
      material.dispose();
    },
    [material]
  );

  // R3F intrinsic JSX — typed via @react-three/fiber.
  return (
    // @ts-expect-error -- R3F intrinsic element; types provided by @react-three/fiber when consumer installs it.
    <sprite position={[0, yOffset, 0]} scale={[size, size, size]} material={material} />
  );
};
