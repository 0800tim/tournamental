/**
 * Animation-clip loader contract.
 *
 * The renderer's animation FSM (docs/04) maps spec `AnimTag` values to a
 * fixed set of GLB files in `apps/web/public/animations/`. We expose:
 *
 *  - `ANIMATION_FILES`   — manifest of expected files (one per `AnimTag`).
 *  - `loadAnimationClip` — fetch + extract the first clip from a GLB.
 *  - `loadAnimationLibrary` — preload all 15 clips into a `Map<AnimTag,
 *    AnimationClip>` for the renderer's shared `AnimationMixer` template.
 *
 * Files that are not yet authored will reject with a clear error so the
 * renderer can fall back to `idle` per the FSM spec.
 */
import type { AnimTag } from "@vtorn/spec";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export const ANIMATION_FILES: Record<AnimTag, string> = {
  idle: "/animations/idle.glb",
  walk: "/animations/walk.glb",
  run: "/animations/run.glb",
  sprint: "/animations/sprint.glb",
  kick: "/animations/kick.glb",
  pass: "/animations/pass.glb",
  header: "/animations/header.glb",
  shoot: "/animations/shoot.glb",
  tackle: "/animations/tackle.glb",
  fall: "/animations/fall.glb",
  celebrate: "/animations/celebrate.glb",
  throw: "/animations/throw.glb",
  catch: "/animations/catch.glb",
  dribble: "/animations/dribble.glb",
  jump: "/animations/jump.glb",
};

/** Animations shipped in the v0.1 build. The rest are stubs / TBD. */
export const SHIPPED_ANIMATIONS: AnimTag[] = ["idle", "run", "kick"];

export interface LoadAnimationOptions {
  /** Override the loader (tests). */
  loader?: GLTFLoader;
  /** URL prefix prepended to each manifest entry. Defaults to ''. */
  baseUrl?: string;
}

/**
 * Load a single animation GLB and return the first clip. The clip is
 * renamed to its `tag` for tidy debugging.
 */
export async function loadAnimationClip(
  tag: AnimTag,
  options: LoadAnimationOptions = {}
): Promise<THREE.AnimationClip> {
  const url = (options.baseUrl ?? "") + ANIMATION_FILES[tag];
  const loader = options.loader ?? new GLTFLoader();
  const gltf = await new Promise<{ animations: THREE.AnimationClip[] }>((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
  const clip = gltf.animations[0];
  if (!clip) {
    throw new Error(`[@vtorn/avatar] animation "${tag}" loaded from ${url} contains no clips.`);
  }
  clip.name = tag;
  return clip;
}

/**
 * Eagerly preload every shipped clip. Missing clips resolve to `null` so
 * the renderer can substitute `idle` without throwing.
 */
export async function loadAnimationLibrary(
  tags: AnimTag[] = SHIPPED_ANIMATIONS,
  options: LoadAnimationOptions = {}
): Promise<Map<AnimTag, THREE.AnimationClip | null>> {
  const out = new Map<AnimTag, THREE.AnimationClip | null>();
  await Promise.all(
    tags.map(async (tag) => {
      try {
        const clip = await loadAnimationClip(tag, options);
        out.set(tag, clip);
      } catch (err) {
        console.warn(`[@vtorn/avatar] failed to load "${tag}":`, err);
        out.set(tag, null);
      }
    })
  );
  return out;
}
