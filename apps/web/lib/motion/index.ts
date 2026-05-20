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
 * Shared motion grammar for play.tournamental.com.
 *
 * One gsap import, one ScrollTrigger registration, one `prefers-reduced-
 * motion` helper. Hooks live alongside this module so the play app speaks
 * a single motion vocabulary instead of one-off CSS keyframes scattered
 * across feature folders.
 *
 * Read `docs/BRAND.md` section 4 before adding motion to a new surface.
 * The contract:
 *   - Defaults are visible. No baked-in `opacity: 0`. JS opts elements
 *     into the hidden-then-fade dance at runtime.
 *   - `prefers-reduced-motion: reduce` collapses every animation to
 *     instant. Use the `reduceMotion()` helper rather than inlining the
 *     media query check; it's SSR-safe.
 *   - 200-900ms durations, `power2.out` / `power3.out` easing. No bounce,
 *     no spring, no parallax. Editorial restraint.
 *   - Gold (`var(--vt-gold-400)`) is the only accent. If a hook needs a
 *     colour, it pulls from the gold scale, never from the deprecated
 *     sky-blue or flame tokens.
 *
 * Model after `apps/web/lib/bracket/use-cascade-pulse.ts` — the existing
 * "single motion grammar" reference hook.
 */

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// ScrollTrigger.register pre-arms a `prefers-reduced-motion` media
// query at register time, which throws under jsdom (no matchMedia).
// Some tests install matchMedia *after* importing this module, so we
// cache the registration state and arm lazily via `armScrollTrigger()`
// the first time a hook actually uses ScrollTrigger.
let _registered = false;

/**
 * Idempotent ScrollTrigger registration. Returns `true` once the plugin
 * has been armed and is usable, `false` when the host lacks
 * `matchMedia` (SSR / older jsdom). Hooks call this before invoking
 * `ScrollTrigger.create`.
 */
export function armScrollTrigger(): boolean {
  if (_registered) return true;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  gsap.registerPlugin(ScrollTrigger);
  _registered = true;
  return true;
}

// Eager attempt at module load. Production browsers register here; test
// runners that mock matchMedia later fall through to the lazy path.
if (typeof window !== "undefined") {
  armScrollTrigger();
}

export { gsap, ScrollTrigger };

/**
 * SSR-safe `prefers-reduced-motion: reduce` check. Returns `false` on the
 * server and on browsers without `matchMedia`, so hooks degrade to "play
 * the animation" rather than "skip everything" when the platform can't
 * answer the question.
 */
export function reduceMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export { useCountUp } from "./use-count-up";
export { useRevealOnScroll } from "./use-reveal-on-scroll";
export { useNodeHoverGlow } from "./use-node-hover-glow";
