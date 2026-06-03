/*
 * Copyright 2026 Tournamental
 *
 * Licensed under the Apache Licence, Version 2.0 (the "Licence");
 * you may not use this file except in compliance with the Licence.
 * You may obtain a copy of the Licence at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * useNodeHoverGlow, smoothly tween a three.js material's opacity + scale
 * when a 3D node enters/exits a hover state.
 *
 * This is the canonical R3F + GSAP pattern: instead of swapping
 * `material.opacity` between two static values on each React render
 * (which jumps), we run `gsap.to(material, { opacity, ... })` so the
 * change rides a 200ms `power2.out` curve. Same easing the rest of the
 * motion grammar uses (see `lib/bracket/use-cascade-pulse.ts`).
 *
 * The hook owns its own tween and kills the previous one before
 * starting a new one, so back-to-back hover-enter/leave sequences never
 * queue overlapping animations.
 *
 * Respects `prefers-reduced-motion`: under reduced motion the hook
 * snaps the target value into place without a tween.
 */

"use client";

import { useEffect, useRef } from "react";
import type * as THREE from "three";

import { gsap, reduceMotion } from "./index";

export interface NodeHoverGlowOptions {
  /** Tween duration in seconds. Defaults to 0.2 — the brief's 200ms. */
  readonly duration?: number;
  /** GSAP ease preset. Defaults to `power2.out`. */
  readonly ease?: string;
}

/**
 * Tween a material's `opacity` toward `target` whenever `target`
 * changes. Mounts a tween-on-change effect against the material ref.
 *
 * Designed to be called inside a component that already holds the
 * material ref (e.g. via `useRef<THREE.MeshBasicMaterial>`).
 */
export function useNodeHoverGlow(
  // React 19 typings: useRef<T>(null) now yields RefObject<T | null>,
  // so accept the nullable variant rather than the never-null one.
  materialRef: React.RefObject<
    (THREE.Material & { opacity: number; transparent?: boolean }) | null
  >,
  target: number,
  options: NodeHoverGlowOptions = {},
): void {
  const { duration = 0.2, ease = "power2.out" } = options;
  const prevTargetRef = useRef<number | null>(null);

  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;

    // First mount: stamp the value without animating so the initial
    // paint matches the SSR-equivalent state.
    if (prevTargetRef.current === null) {
      material.opacity = target;
      prevTargetRef.current = target;
      return;
    }

    if (prevTargetRef.current === target) return;
    prevTargetRef.current = target;

    if (reduceMotion()) {
      material.opacity = target;
      return;
    }

    gsap.killTweensOf(material);
    gsap.to(material, {
      opacity: target,
      duration,
      ease,
    });
  }, [materialRef, target, duration, ease]);
}
