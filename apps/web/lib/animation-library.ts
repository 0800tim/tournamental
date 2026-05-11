"use client";

import { useEffect, useState } from "react";
import type * as THREE from "three";
import type { AnimTag } from "@tournamental/spec";
import { loadMixamoPack } from "@vtorn/avatar";

/**
 * Module-cached Mixamo-pack load. Triggered the first time
 * `useAnimationLibrary` mounts; every subsequent mount resolves from
 * the cache. Keeps the network footprint at "one fetch per clip,
 * regardless of how many <Player>s are on screen".
 */
let cachedPromise: Promise<Map<AnimTag, THREE.AnimationClip | null>> | null = null;

function getLibraryPromise(): Promise<Map<AnimTag, THREE.AnimationClip | null>> {
  if (!cachedPromise) {
    cachedPromise = loadMixamoPack().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("[animation-library] failed to load mixamo pack:", err);
      cachedPromise = null;
      return new Map();
    });
  }
  return cachedPromise;
}

/**
 * Hook: load the Phase-1 Mixamo-pack once and return the cached clip
 * map. Returns null while the load is in flight so callers can fall
 * back to a static pose / capsule.
 */
export function useAnimationLibrary(): Map<AnimTag, THREE.AnimationClip | null> | null {
  const [lib, setLib] = useState<Map<AnimTag, THREE.AnimationClip | null> | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLibraryPromise().then((m) => {
      if (cancelled) return;
      setLib(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return lib;
}

/** Test-only: clear the module cache. */
export function __resetAnimationLibrary(): void {
  cachedPromise = null;
}
