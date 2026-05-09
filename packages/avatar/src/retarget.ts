/**
 * Bone retargeting helpers.
 *
 * The shared body GLB and the bundled animation pack both use Mixamo's
 * `mixamorig*` bone naming (no separator — that's how three.js's
 * `GLTFExporter` writes them when the source skeleton uses Mixamo's
 * convention). When we one day import a third-party FBX (Adobe Mixamo
 * direct export, Quaternius, RPM full-body GLB) the names may use the
 * `mixamorig:` prefix or no prefix at all. We need a tiny normaliser so
 * `AnimationClip` tracks bind to whatever skeleton the renderer mounts.
 *
 * This file is pure-data + pure-function so it unit-tests without
 * three.js. The runtime path (`retargetClip`) takes an `AnimationClip`
 * and returns a *new* clip with renamed tracks.
 */
import * as THREE from "three";

/** Bone-name styles we accept from external rigs. */
export type BoneNamingStyle = "mixamo_prefix" | "mixamo_compact" | "rpm" | "raw";

/**
 * Canonical compact bone names (matches our shipped body GLB).
 * One per logical joint; arms/legs duplicated as Left/Right.
 */
export const CANONICAL_BONES = [
  "mixamorigHips",
  "mixamorigSpine",
  "mixamorigSpine1",
  "mixamorigSpine2",
  "mixamorigNeck",
  "mixamorigHead",
  "mixamorigLeftShoulder",
  "mixamorigLeftArm",
  "mixamorigLeftForeArm",
  "mixamorigLeftHand",
  "mixamorigRightShoulder",
  "mixamorigRightArm",
  "mixamorigRightForeArm",
  "mixamorigRightHand",
  "mixamorigLeftUpLeg",
  "mixamorigLeftLeg",
  "mixamorigLeftFoot",
  "mixamorigRightUpLeg",
  "mixamorigRightLeg",
  "mixamorigRightFoot",
] as const;

export type CanonicalBone = (typeof CANONICAL_BONES)[number];

/** RPM full-body's bone names map directly to mixamorig if you strip the prefix. */
const RPM_TO_MIXAMO: Record<string, string> = Object.fromEntries(
  CANONICAL_BONES.map((b) => [b.replace("mixamorig", ""), b]),
);

/**
 * Detect the bone-naming style of a list of bone names. We only need
 * one positive hit to be confident.
 */
export function detectBoneStyle(names: readonly string[]): BoneNamingStyle {
  for (const n of names) {
    if (n.startsWith("mixamorig:")) return "mixamo_prefix";
    if (n.startsWith("mixamorig")) return "mixamo_compact";
  }
  for (const n of names) {
    if (n in RPM_TO_MIXAMO) return "rpm";
  }
  return "raw";
}

/**
 * Convert any-style name → canonical compact. Returns `null` if the
 * name doesn't map to a known joint.
 */
export function toCanonicalBoneName(name: string): CanonicalBone | null {
  if (name.startsWith("mixamorig:")) {
    const compact = "mixamorig" + name.slice("mixamorig:".length);
    return (CANONICAL_BONES as readonly string[]).includes(compact)
      ? (compact as CanonicalBone)
      : null;
  }
  if ((CANONICAL_BONES as readonly string[]).includes(name)) {
    return name as CanonicalBone;
  }
  if (name in RPM_TO_MIXAMO) {
    return RPM_TO_MIXAMO[name] as CanonicalBone;
  }
  return null;
}

/**
 * Build a Map<sourceBoneName, canonicalBoneName> from a skeleton's bone
 * list. Bones that don't map to a canonical joint are omitted.
 */
export function buildRetargetMap(boneNames: readonly string[]): Map<string, CanonicalBone> {
  const out = new Map<string, CanonicalBone>();
  for (const name of boneNames) {
    const canonical = toCanonicalBoneName(name);
    if (canonical) out.set(name, canonical);
  }
  return out;
}

/**
 * Return a clone of `clip` with every track's `boneName` portion
 * rewritten to the canonical compact name. The track's property suffix
 * (`.position`, `.quaternion`, `.scale`) is preserved.
 *
 * Tracks whose bone doesn't map to a canonical joint are dropped. If
 * `keepUnknown` is true, they're kept verbatim instead.
 */
export function retargetClip(
  clip: THREE.AnimationClip,
  options: { keepUnknown?: boolean } = {},
): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const track of clip.tracks) {
    const dotIdx = track.name.indexOf(".");
    if (dotIdx < 0) {
      if (options.keepUnknown) tracks.push(track.clone());
      continue;
    }
    const bone = track.name.slice(0, dotIdx);
    const property = track.name.slice(dotIdx);
    const canonical = toCanonicalBoneName(bone);
    if (!canonical) {
      if (options.keepUnknown) tracks.push(track.clone());
      continue;
    }
    const cloned = track.clone();
    cloned.name = canonical + property;
    tracks.push(cloned);
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
}

/**
 * Walk a Three Object3D and find the first bone whose name maps to
 * `canonical`. Returns null if no match — the caller can decide whether
 * to throw or fall back (e.g. attach the face billboard to the root).
 */
export function findCanonicalBone(
  root: THREE.Object3D,
  canonical: CanonicalBone,
): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((obj) => {
    if (found) return;
    if (toCanonicalBoneName(obj.name) === canonical) found = obj;
  });
  return found;
}
