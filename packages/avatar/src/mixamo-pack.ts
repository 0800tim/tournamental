/**
 * Mixamo-pack registry.
 *
 * docs/27a-fidelity-phase1-mocap-rig.md describes a one-time bake step
 * that retargets a curated Mixamo animation pack onto our canonical
 * skeleton. In dev / OSS mode we ship the pack at
 * `apps/web/public/animations/<tag>.glb`, one file per `AnimTag`.
 *
 * Sandbox note: Mixamo requires Adobe sign-in, so the OSS pipeline
 * cannot fetch its FBX archive automatically. Our `build-assets.mjs`
 * authors compatible CC0 clips on the same canonical skeleton — see
 * `packages/avatar/README.md` § "Asset substitution policy".
 *
 * This module exposes:
 *
 *   - `MIXAMO_PACK` — declarative registry of expected clip metadata
 *     (tag → source / natural ground-speed / loop-style).
 *   - `loadMixamoPack` — convenience wrapper around `loadAnimationLibrary`
 *     that ALSO calls `retargetClip` so the loaded clips bind to our
 *     canonical bones regardless of the source rig.
 */
import type { AnimTag } from "@vtorn/spec";
import * as THREE from "three";
import {
  ANIMATION_FILES,
  loadAnimationClip,
  type LoadAnimationOptions,
} from "./animations.js";
import { retargetClip } from "./retarget.js";

/** Static metadata for each shipped clip. */
export interface MixamoClipDescriptor {
  tag: AnimTag;
  source: "mixamo" | "self_authored_cc0";
  /** Natural ground speed in m/s (locomotion clips only). 0 = stationary. */
  naturalSpeedMs: number;
  /** Default loop style used when the clip plays. */
  loop: "once" | "repeat";
  /**
   * Original Mixamo clip name (informational; for follow-up bakes).
   * Empty string for self-authored.
   */
  mixamoName: string;
}

/** docs/27a § Asset Pipeline — Mixamo clips required by Phase 1. */
export const MIXAMO_PACK: Record<AnimTag, MixamoClipDescriptor> = {
  idle: { tag: "idle", source: "self_authored_cc0", naturalSpeedMs: 0, loop: "repeat", mixamoName: "Idle" },
  walk: { tag: "walk", source: "self_authored_cc0", naturalSpeedMs: 1.4, loop: "repeat", mixamoName: "Walking" },
  run: { tag: "run", source: "self_authored_cc0", naturalSpeedMs: 4.0, loop: "repeat", mixamoName: "Running" },
  sprint: { tag: "sprint", source: "self_authored_cc0", naturalSpeedMs: 6.5, loop: "repeat", mixamoName: "Fast Run" },
  pass: { tag: "pass", source: "self_authored_cc0", naturalSpeedMs: 0, loop: "once", mixamoName: "Soccer Pass" },
  kick: { tag: "kick", source: "self_authored_cc0", naturalSpeedMs: 0, loop: "once", mixamoName: "Soccer Kick" },
  shoot: { tag: "shoot", source: "self_authored_cc0", naturalSpeedMs: 0, loop: "once", mixamoName: "Soccer Shot" },
  header: { tag: "header", source: "self_authored_cc0", naturalSpeedMs: 0, loop: "once", mixamoName: "Soccer Header" },
  tackle: { tag: "tackle", source: "self_authored_cc0", naturalSpeedMs: 0, loop: "once", mixamoName: "Slide Tackle" },
  fall: { tag: "fall", source: "self_authored_cc0", naturalSpeedMs: 0, loop: "once", mixamoName: "Falling" },
  celebrate: { tag: "celebrate", source: "self_authored_cc0", naturalSpeedMs: 0, loop: "once", mixamoName: "Goal Celebration" },
  throw: { tag: "throw", source: "self_authored_cc0", naturalSpeedMs: 0, loop: "once", mixamoName: "Throw In" },
  catch: { tag: "catch", source: "self_authored_cc0", naturalSpeedMs: 0, loop: "once", mixamoName: "GK Catch" },
  dribble: { tag: "dribble", source: "self_authored_cc0", naturalSpeedMs: 3.0, loop: "repeat", mixamoName: "Dribble" },
  jump: { tag: "jump", source: "self_authored_cc0", naturalSpeedMs: 0, loop: "once", mixamoName: "Jump Up" },
};

/** Tags shipped in the v0.1 Phase 1 cut. */
export const PHASE1_TAGS: AnimTag[] = [
  "idle",
  "walk",
  "run",
  "sprint",
  "pass",
  "kick",
  "shoot",
  "header",
  "tackle",
  "fall",
  "celebrate",
  "catch",
];

export interface LoadMixamoPackOptions extends LoadAnimationOptions {
  /** Tags to load. Defaults to `PHASE1_TAGS`. */
  tags?: AnimTag[];
  /** If true (default), each clip is passed through `retargetClip`. */
  retarget?: boolean;
}

/**
 * Load the Mixamo pack and retarget each clip onto our canonical
 * skeleton. Failures resolve to `null` so the FSM can fall back to idle
 * without throwing.
 */
export async function loadMixamoPack(
  options: LoadMixamoPackOptions = {},
): Promise<Map<AnimTag, THREE.AnimationClip | null>> {
  const tags = options.tags ?? PHASE1_TAGS;
  const retarget = options.retarget ?? true;
  const out = new Map<AnimTag, THREE.AnimationClip | null>();

  await Promise.all(
    tags.map(async (tag) => {
      try {
        const raw = await loadAnimationClip(tag, options);
        const finalClip = retarget ? retargetClip(raw, { keepUnknown: true }) : raw;
        finalClip.name = tag;
        out.set(tag, finalClip);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[@vtorn/avatar] mixamo-pack: failed "${tag}":`, err);
        out.set(tag, null);
      }
    }),
  );

  return out;
}

/** Convenience: get the full source URL for a tag (for preload tags). */
export function packUrl(tag: AnimTag, baseUrl = ""): string {
  return baseUrl + ANIMATION_FILES[tag];
}
