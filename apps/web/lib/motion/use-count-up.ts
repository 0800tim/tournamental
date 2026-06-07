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
 * useCountUp, tween a numeric DOM node from 0 to its target when the
 * element scrolls into view.
 *
 * Used for the bracket lock-summary's points + multiplier rows and the
 * share landing's leaderboard score column. Both surfaces render the
 * final value as text (Fraunces, tabular-nums), then GSAP rewrites the
 * `textContent` mid-tween via `onUpdate`.
 *
 * The element shows the target value as the SSR default so no-JS users
 * and crawlers see the right number. The hook only kicks in once
 * ScrollTrigger fires on the client, so progressive enhancement is
 * preserved (the value is never `0` in the markup).
 *
 * Respects `prefers-reduced-motion`: the hook stamps the target value
 * once and skips the tween entirely.
 */

"use client";

import { useEffect, useRef } from "react";

import { armScrollTrigger, gsap, ScrollTrigger, reduceMotion } from "./index";

export interface CountUpOptions {
  /** Target integer to count up to. Negative or NaN collapses to 0. */
  readonly value: number;
  /** Tween duration in seconds. Defaults to 0.9. */
  readonly duration?: number;
  /** GSAP ease preset. Defaults to `power2.out` per BRAND.md §4. */
  readonly ease?: string;
  /**
   * Formatter run on every frame. Defaults to integer rounding so the
   * numeric display never flickers a stray decimal. Callers that need
   * commas / currency / "%" pass their own formatter.
   */
  readonly format?: (n: number) => string;
  /**
   * When true, skip the animation and just stamp the formatted value.
   * Lets callers opt out (e.g. when the same element renders on the
   * server already painted with the final value).
   */
  readonly skip?: boolean;
}

const DEFAULT_DURATION = 0.9;

/** Default integer formatter, locale-neutral so SSR + client agree. */
function defaultFormat(n: number): string {
  return String(Math.round(n));
}

/**
 * Returns a ref to attach to the text node (typically a `<span>` or
 * `<strong>`). The element's initial textContent is whatever the caller
 * rendered server-side; the hook only changes it once the element
 * scrolls into view AND reduced-motion is off.
 *
 * Re-runs whenever `value` changes so paginated leaderboards (or
 * resaved brackets) re-tween to the new total.
 */
export function useCountUp<T extends HTMLElement = HTMLElement>(
  options: CountUpOptions,
): React.RefObject<T | null> {
  const elRef = useRef<T>(null);
  const {
    value,
    duration = DEFAULT_DURATION,
    ease = "power2.out",
    format = defaultFormat,
    skip = false,
  } = options;

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const target = Number.isFinite(value) ? Math.max(0, value) : 0;

    // Reduced motion / explicit skip: stamp the final value and bail.
    if (reduceMotion() || skip) {
      el.textContent = format(target);
      return;
    }

    // Test environments (jsdom) skip ScrollTrigger registration because
    // `matchMedia` isn't there, so calling ScrollTrigger.create would
    // throw `_context is not a function`. Detect and stamp the final
    // value instead, matching the reduced-motion path.
    if (!armScrollTrigger()) {
      el.textContent = format(target);
      return;
    }

    // Tween a private holder so we don't churn React state every frame.
    // We DON'T overwrite el.textContent here, the SSR-rendered number
    // stays visible until the section scrolls into view (Tim 2026-06-07,
    // previously a 1-correct-pick leaderboard rendered '0' on first
    // paint, only animating up to '1' once the user scrolled — fine
    // for big jingoistic ticker numbers, jarring for a leaderboard).
    const holder = { v: 0 };

    const tween = gsap.to(holder, {
      v: target,
      duration,
      ease,
      paused: true,
      onUpdate: () => {
        el.textContent = format(holder.v);
      },
      onComplete: () => {
        // Snap to the exact target so floating-point dust doesn't leak.
        el.textContent = format(target);
      },
    });

    const trigger = ScrollTrigger.create({
      trigger: el,
      // Fire when the top of the element passes ~85% down the viewport,
      // i.e. it has come into view but isn't fully centred. Same rhythm
      // as the IntersectionObserver-based reveals on marketing.
      start: "top 85%",
      once: true,
      onEnter: () => {
        // Reset to 0 the moment the tween starts so the animation has
        // somewhere to count up from.
        holder.v = 0;
        el.textContent = format(0);
        tween.play();
      },
    });

    return () => {
      trigger.kill();
      tween.kill();
      // Restore the final value so layout-shift on unmount doesn't
      // briefly flash a partial count.
      if (el) el.textContent = format(target);
    };
  }, [value, duration, ease, format, skip]);

  return elRef;
}
