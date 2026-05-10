/**
 * Mobile-only gesture primitives for the bracket UI.
 *
 * These hooks are no-ops on viewports wider than 640px so desktop
 * pointer / keyboard interactions are untouched. They use native
 * Touch / IntersectionObserver APIs only — no third-party gesture
 * library — to keep the bundle lean and avoid pulling in a
 * dependency that ships its own touch event abstractions.
 *
 * Hooks exported:
 *   - usePinchZoom: two-finger pinch + double-tap zoom on a container.
 *     Translates the wrapped child via CSS `transform: scale(...)` with
 *     a transform-origin pinned to the midpoint of the two fingers.
 *   - useStickyGroupHeaders: adds an `is-stuck` class to a sticky
 *     header element when it has hit the top of its scroll container,
 *     so we can apply a shadow without paying for a scroll listener.
 *   - useHaptic: returns a `vibrate(pattern)` function that respects
 *     `prefers-reduced-motion` and gracefully no-ops on devices that
 *     don't support `navigator.vibrate`.
 *   - useScrollIntoViewIfHidden: imperative helper to smooth-scroll an
 *     element into view only when it's currently off-screen — used by
 *     the cascade so an upstream pick that affects a downstream slot
 *     doesn't yank the user around when the affected card is already
 *     visible.
 *
 * Tests live in `apps/web/__tests__/bracket-mobile-gestures.test.tsx`.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Mobile media-query breakpoint mirroring the bracket CSS. */
export const MOBILE_MQ = "(max-width: 640px)";

/** Standard haptic patterns used across the bracket UI. */
export const HAPTIC = {
  /** Tiny tap — group / knockout pick. */
  pick: 8,
  /** Slightly longer cascade-resolved knockout pick: tap, pause, tap. */
  cascadeResolved: [8, 30, 8] as const,
} as const;

/** SSR-safe matchMedia check. */
function matchesMedia(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(query).matches;
}

/** Returns true when the user has asked the OS for reduced motion. */
export function prefersReducedMotion(): boolean {
  return matchesMedia("(prefers-reduced-motion: reduce)");
}

/** Returns true when the viewport is at the mobile breakpoint. */
export function isMobileViewport(): boolean {
  return matchesMedia(MOBILE_MQ);
}

/**
 * Fire a haptic vibration with graceful fallbacks.
 *
 * Native shell precedence: when running inside the Capacitor wrapper
 * (`window.Capacitor.isNativePlatform()`), this *also* dispatches
 * `Haptics.impact()` via `@/lib/native` — the `navigator.vibrate`
 * call typically no-ops in iOS WKWebView, so the native impact is the
 * one users actually feel. The native call is fire-and-forget so this
 * function stays synchronous + boolean-returning for existing callers.
 *
 * - No-op on SSR.
 * - No-op when the device has no `navigator.vibrate` AND we're not on
 *   the native shell.
 * - No-op when the user has set `prefers-reduced-motion: reduce`.
 *
 * Returns true when a vibration was actually triggered (either native
 * haptic dispatched OR `navigator.vibrate` returned true).
 */
export function vibrate(pattern: number | readonly number[]): boolean {
  if (prefersReducedMotion()) return false;

  // Native haptic — fire and forget. The shim is gated on
  // `window.Capacitor.isNativePlatform()`, so this is a no-op on the
  // plain web. Style is chosen by total pattern length: short single
  // tap → light, longer / multi-step → medium.
  let nativeFired = false;
  if (
    typeof window !== "undefined" &&
    window.Capacitor?.isNativePlatform?.()
  ) {
    const total =
      typeof pattern === "number"
        ? pattern
        : pattern.reduce((s, n) => s + n, 0);
    const style: "light" | "medium" | "heavy" =
      total >= 50 ? "heavy" : total >= 20 ? "medium" : "light";
    void import("@/lib/native").then((m) => {
      void m.tapFeedback(style);
    });
    nativeFired = true;
  }

  if (typeof navigator === "undefined") return nativeFired;
  const nav = navigator as Navigator & {
    vibrate?: (p: number | number[]) => boolean;
  };
  if (typeof nav.vibrate !== "function") return nativeFired;
  // navigator.vibrate types want a mutable number[], so spread out a copy.
  const safe = typeof pattern === "number" ? pattern : [...pattern];
  try {
    const ok = nav.vibrate(safe);
    return ok || nativeFired;
  } catch {
    return nativeFired;
  }
}

/**
 * Hook wrapper around `vibrate` so callers can stably depend on it
 * without re-creating closures each render.
 */
export function useHaptic(): (pattern: number | readonly number[]) => boolean {
  return useCallback((pattern) => vibrate(pattern), []);
}

/* -----------------------------------------------------------------
 * Pinch-zoom
 * ----------------------------------------------------------------- */

export interface PinchZoomOptions {
  readonly minScale?: number;
  readonly maxScale?: number;
  readonly doubleTapScale?: number;
  /** Only enable on mobile viewports. Default true. */
  readonly mobileOnly?: boolean;
}

const DEFAULT_PINCH: Required<PinchZoomOptions> = {
  minScale: 0.7,
  maxScale: 1.6,
  doubleTapScale: 1.2,
  mobileOnly: true,
};

interface PinchState {
  scale: number;
  baseScale: number;
  startDistance: number;
  originX: number;
  originY: number;
  lastTap: number;
}

/**
 * Attach two-finger pinch and double-tap zoom handlers to a container
 * element. The hook applies the scale via inline CSS transform on the
 * `target` element (which should be the scaling content, typically a
 * direct child of the touch-capture container).
 *
 * The container itself is the touch-capture surface — pinch within it
 * scales the target, with transform-origin set to the midpoint of the
 * two fingers so the zoom feels anchored where the user pinched.
 *
 * Single-finger touches are explicitly NOT intercepted, so the native
 * horizontal scroll on `.km-grid` keeps working at scale=1.
 *
 * Implementation note: we use callback refs (not `useRef`) so the
 * effect re-runs as soon as both DOM nodes mount, not just at
 * component-mount time. The knockouts tab is conditionally rendered
 * by the parent, so the refs only populate on tab switch.
 */
export function usePinchZoom<C extends HTMLElement, T extends HTMLElement>(
  options: PinchZoomOptions = {},
): {
  containerRef: (el: C | null) => void;
  targetRef: (el: T | null) => void;
} {
  const opts = { ...DEFAULT_PINCH, ...options };
  const [container, setContainer] = useState<C | null>(null);
  const [target, setTarget] = useState<T | null>(null);
  const stateRef = useRef<PinchState>({
    scale: 1,
    baseScale: 1,
    startDistance: 0,
    originX: 50,
    originY: 50,
    lastTap: 0,
  });

  useEffect(() => {
    if (!container || !target) return;
    if (opts.mobileOnly && !isMobileViewport()) return;

    // Make the transform actually apply.
    target.style.transformOrigin = `${stateRef.current.originX}% ${stateRef.current.originY}%`;
    target.style.willChange = "transform";

    const apply = (): void => {
      const s = stateRef.current.scale;
      target.style.transform = s === 1 ? "" : `scale(${s.toFixed(3)})`;
    };

    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length === 2) {
        const [a, b] = [e.touches[0]!, e.touches[1]!];
        const dx = b.clientX - a.clientX;
        const dy = b.clientY - a.clientY;
        stateRef.current.startDistance = Math.hypot(dx, dy);
        stateRef.current.baseScale = stateRef.current.scale;
        const rect = container.getBoundingClientRect();
        const midX = (a.clientX + b.clientX) / 2 - rect.left;
        const midY = (a.clientY + b.clientY) / 2 - rect.top;
        stateRef.current.originX = (midX / Math.max(1, rect.width)) * 100;
        stateRef.current.originY = (midY / Math.max(1, rect.height)) * 100;
        target.style.transformOrigin = `${stateRef.current.originX}% ${stateRef.current.originY}%`;
      } else if (e.touches.length === 1) {
        // Double-tap toggle.
        const now = Date.now();
        if (now - stateRef.current.lastTap < 300) {
          const t = e.touches[0]!;
          const rect = container.getBoundingClientRect();
          stateRef.current.originX = ((t.clientX - rect.left) / Math.max(1, rect.width)) * 100;
          stateRef.current.originY = ((t.clientY - rect.top) / Math.max(1, rect.height)) * 100;
          target.style.transformOrigin = `${stateRef.current.originX}% ${stateRef.current.originY}%`;
          stateRef.current.scale = stateRef.current.scale === 1 ? opts.doubleTapScale : 1;
          stateRef.current.lastTap = 0;
          apply();
        } else {
          stateRef.current.lastTap = now;
        }
      }
    };

    const onTouchMove = (e: TouchEvent): void => {
      if (e.touches.length !== 2 || stateRef.current.startDistance === 0) return;
      // Two fingers down → we own the gesture; prevent the page from
      // pinch-zooming the whole document.
      if (e.cancelable) e.preventDefault();
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      const dx = b.clientX - a.clientX;
      const dy = b.clientY - a.clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / stateRef.current.startDistance;
      const next = Math.max(opts.minScale, Math.min(opts.maxScale, stateRef.current.baseScale * ratio));
      stateRef.current.scale = next;
      apply();
    };

    const onTouchEnd = (e: TouchEvent): void => {
      if (e.touches.length < 2) {
        stateRef.current.startDistance = 0;
      }
    };

    // touchmove must NOT be passive — we call preventDefault to stop
    // the browser from also pinch-zooming the whole page when two
    // fingers land on the grid. touchstart / touchend can stay
    // passive: we only read the events, never block default action.
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: true });
    container.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
      target.style.transform = "";
      target.style.willChange = "";
    };
  }, [container, target, opts.minScale, opts.maxScale, opts.doubleTapScale, opts.mobileOnly]);

  const containerRef = useCallback((el: C | null) => setContainer(el), []);
  const targetRef = useCallback((el: T | null) => setTarget(el), []);
  return useMemo(() => ({ containerRef, targetRef }), [containerRef, targetRef]);
}

/* -----------------------------------------------------------------
 * Sticky group headers
 * ----------------------------------------------------------------- */

export interface StickyHeaderOptions {
  /** Selector relative to the root for sticky elements. */
  readonly headerSelector: string;
  /** CSS class added when the element is stuck. */
  readonly stuckClass?: string;
  /** Only enable on mobile viewports. Default true. */
  readonly mobileOnly?: boolean;
}

/**
 * Tag every element matching `headerSelector` inside `rootRef` with
 * `is-stuck` when it has scrolled to the top of its containing scroll
 * port. We use a sentinel IntersectionObserver pattern: each header
 * has a 1px-tall sentinel placed immediately before it; when the
 * sentinel scrolls out of the top of the viewport, the header is
 * stuck.
 *
 * IntersectionObserver is ~free at runtime; no scroll listener.
 */
export function useStickyGroupHeaders<R extends HTMLElement>(
  options: StickyHeaderOptions,
): (el: R | null) => void {
  const [root, setRoot] = useState<R | null>(null);
  const { headerSelector, stuckClass = "is-stuck", mobileOnly = true } = options;

  useEffect(() => {
    if (!root) return;
    if (mobileOnly && !isMobileViewport()) return;
    if (typeof IntersectionObserver === "undefined") return;

    const headers = Array.from(root.querySelectorAll<HTMLElement>(headerSelector));
    if (headers.length === 0) return;

    const sentinels: HTMLElement[] = [];
    const sentinelToHeader = new Map<Element, HTMLElement>();

    for (const header of headers) {
      const s = document.createElement("div");
      s.dataset.stickySentinel = "";
      s.style.height = "1px";
      s.style.marginBottom = "-1px";
      s.style.pointerEvents = "none";
      s.style.visibility = "hidden";
      header.parentElement?.insertBefore(s, header);
      sentinels.push(s);
      sentinelToHeader.set(s, header);
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const header = sentinelToHeader.get(entry.target);
          if (!header) continue;
          // Sentinel is above the header. When it leaves the viewport
          // (scrolled past the top edge), the header is stuck.
          if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
            header.classList.add(stuckClass);
          } else {
            header.classList.remove(stuckClass);
          }
        }
      },
      { threshold: [0, 1] },
    );

    for (const s of sentinels) io.observe(s);

    return () => {
      io.disconnect();
      for (const s of sentinels) s.parentElement?.removeChild(s);
      for (const h of headers) h.classList.remove(stuckClass);
    };
  }, [root, headerSelector, stuckClass, mobileOnly]);

  return useCallback((el: R | null) => setRoot(el), []);
}

/* -----------------------------------------------------------------
 * Scroll-into-view if hidden
 * ----------------------------------------------------------------- */

/** Returns true when `el` is fully outside the visible viewport. */
function isOffScreen(el: Element): boolean {
  if (typeof window === "undefined") return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  return r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw;
}

/**
 * Smooth-scrolls `el` into view, but only when it's currently
 * off-screen. Respects `prefers-reduced-motion` by using `instant`
 * behaviour when the user has asked for reduced motion.
 */
export function scrollIntoViewIfHidden(el: Element | null): boolean {
  if (!el) return false;
  if (typeof window === "undefined") return false;
  if (!isOffScreen(el)) return false;
  const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
  el.scrollIntoView({ behavior, block: "center", inline: "nearest" });
  return true;
}
