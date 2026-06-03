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
 * useRevealOnScroll, fade-and-rise a region's direct children into view
 * as they cross the viewport edge.
 *
 * The play-app counterpart to the marketing site's `.vt-reveal`. Same
 * grammar (8-14px translate + opacity, 600ms power3.out, light stagger
 * between siblings) so the two surfaces feel like one product.
 *
 * Progressive-enhancement contract:
 *   - Elements are visible by default. The hook only switches them to
 *     hidden-then-fade at runtime, so no-JS visitors, crawlers, and
 *     screen recordings always see the page.
 *   - `prefers-reduced-motion: reduce` makes the hook a no-op. No CSS
 *     side-effects, no inline opacity. The page stays at its end state.
 *   - The hook stamps `data-vt-revealed="true"` on each child once its
 *     animation completes, in case downstream code wants to react.
 *
 * Modelled after `apps/web/lib/bracket/use-cascade-pulse.ts`: register
 * once, animate, clean up. The ScrollTrigger registration lives in
 * `lib/motion/index.ts` so this hook just imports the already-armed
 * plugin.
 */

"use client";

import { useEffect, useRef } from "react";

import { armScrollTrigger, gsap, ScrollTrigger, reduceMotion } from "./index";

export interface RevealOnScrollOptions {
  /**
   * Y-translate distance in pixels for the hidden start state. Defaults
   * to 14, matching the marketing `.vt-reveal` cadence.
   */
  readonly distance?: number;
  /** Tween duration in seconds. Defaults to 0.6. */
  readonly duration?: number;
  /** Stagger between sibling children in seconds. Defaults to 0.07. */
  readonly stagger?: number;
  /**
   * Selector applied to the container's descendants. When set, only
   * elements matching the selector animate. When omitted (the default),
   * the direct children of the container are the animated set.
   */
  readonly selector?: string;
  /**
   * ScrollTrigger start position, GSAP syntax. Defaults to "top 85%",
   * the same rhythm as the marketing IntersectionObserver.
   */
  readonly start?: string;
}

/**
 * Returns a ref to attach to the container element. The hook then picks
 * up its children (or descendants matching `selector`) and reveals them
 * on scroll.
 *
 * Usage:
 *
 *   const ref = useRevealOnScroll<HTMLDivElement>();
 *   return <div ref={ref}>...</div>;
 */
export function useRevealOnScroll<T extends HTMLElement = HTMLElement>(
  options: RevealOnScrollOptions = {},
): React.RefObject<T | null> {
  // React 19 typings make useRef<T>(null) return RefObject<T | null>;
  // reflect that in the return type so callers don't get a mismatched type.
  const containerRef = useRef<T>(null);
  const {
    distance = 14,
    duration = 0.6,
    stagger = 0.07,
    selector,
    start = "top 85%",
  } = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Respect reduced motion without touching styles. Container stays
    // at its visible-by-default state.
    if (reduceMotion()) return;

    // Test environments (jsdom) skip ScrollTrigger registration because
    // `matchMedia` isn't there, so calling ScrollTrigger.create would
    // throw. Leave the container alone so SSR / no-JS / test behaviour
    // all converge on "everything visible by default".
    if (!armScrollTrigger()) return;

    const targets = selector
      ? Array.from(container.querySelectorAll<HTMLElement>(selector))
      : (Array.from(container.children) as HTMLElement[]);
    if (targets.length === 0) return;

    // Stamp the hidden start state via inline style. This means the
    // server-rendered HTML stays visible (no FOUC, no AI-slop empty
    // canvas), but the moment the hook armed we're allowed to hide.
    for (const el of targets) {
      el.style.opacity = "0";
      el.style.transform = `translate3d(0, ${distance}px, 0)`;
      // Hint to the compositor — same trick the cascade-pulse uses.
      el.style.willChange = "opacity, transform";
    }

    const tween = gsap.to(targets, {
      opacity: 1,
      y: 0,
      duration,
      ease: "power3.out",
      stagger,
      paused: true,
      onComplete: () => {
        for (const el of targets) {
          el.style.willChange = "";
          el.setAttribute("data-vt-revealed", "true");
        }
      },
    });

    const trigger = ScrollTrigger.create({
      trigger: container,
      start,
      once: true,
      onEnter: () => tween.play(),
    });

    return () => {
      trigger.kill();
      tween.kill();
      // Restore the visible end state so unmounting mid-tween doesn't
      // leave a section faded out.
      for (const el of targets) {
        el.style.opacity = "";
        el.style.transform = "";
        el.style.willChange = "";
      }
    };
  }, [distance, duration, stagger, selector, start]);

  return containerRef;
}
