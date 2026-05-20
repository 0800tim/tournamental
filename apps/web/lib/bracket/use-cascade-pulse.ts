/**
 * useCascadePulse, fires a single gold pulse on any knockout card whose
 * home or away team slot just became known.
 *
 * The trigger is a *new* slot resolution: when an upstream pick promotes
 * a team into a downstream slot that was previously TBD, the card lights
 * up gold for ~600ms (border colour + 1.5% scale-up) so the user sees
 * which downstream matchup their pick just unlocked.
 *
 * Tuning matches the BRAND.md "elevated gold" rubric and the doc 04
 * cascade contract:
 *   - One motion grammar: gold border + scale, no rainbow.
 *   - Eased out (the easing rides the existing
 *     `cubic-bezier(0.16, 0.84, 0.32, 1)` defined for editorial reveals,
 *     gsap's `power2.out` is the closest preset).
 *   - 600ms total; the scale eases back to 1 in the second half.
 *   - Respects `prefers-reduced-motion`, the pulse becomes a no-op.
 *
 * Identifies cards via `data-match-id="<id>"`, the existing attribute on
 * every `.km-card` rendered by KnockoutMatch.
 */

import { useEffect, useRef } from "react";

import type { CascadedBracket } from "@tournamental/bracket-engine";

/** Lazily resolve gsap so the module can SSR in a Node environment. */
async function loadGsap(): Promise<typeof import("gsap").gsap | null> {
  if (typeof window === "undefined") return null;
  try {
    const mod = await import("gsap");
    return mod.gsap;
  } catch {
    return null;
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Hook: diff each render's cascade knockouts against the previous
 * snapshot and pulse any card whose home or away slot just became
 * known. Returns nothing; side-effects are scoped to DOM nodes the
 * BracketBuilder owns.
 *
 * The hook is a no-op on the first render (we need a previous
 * snapshot to diff against) and a no-op under reduced motion.
 */
export function useCascadePulse(cascaded: CascadedBracket): void {
  const prevRef = useRef<ReadonlyMap<string, { home: string | null; away: string | null }> | null>(
    null,
  );
  const gsapRef = useRef<typeof import("gsap").gsap | null>(null);

  // Resolve gsap once and cache. Failures (e.g. bundle stripped) keep
  // the hook silent rather than throwing.
  useEffect(() => {
    let cancelled = false;
    void loadGsap().then((g) => {
      if (!cancelled) gsapRef.current = g;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const snapshot = new Map<string, { home: string | null; away: string | null }>();
    for (const k of cascaded.knockouts) {
      snapshot.set(k.id, {
        home: k.home.team ?? null,
        away: k.away.team ?? null,
      });
    }

    const prev = prevRef.current;
    prevRef.current = snapshot;

    // First render or reduced motion: just record the snapshot.
    if (!prev || prefersReducedMotion()) return;

    const newlyResolved: string[] = [];
    for (const [id, slots] of snapshot) {
      const before = prev.get(id);
      if (!before) continue;
      const homeNew = !before.home && slots.home;
      const awayNew = !before.away && slots.away;
      if (homeNew || awayNew) newlyResolved.push(id);
    }
    if (newlyResolved.length === 0) return;

    const gsap = gsapRef.current;
    if (!gsap || typeof document === "undefined") return;

    for (const id of newlyResolved) {
      const card = document.querySelector<HTMLElement>(
        `.km-card[data-match-id="${cssEscape(id)}"]`,
      );
      if (!card) continue;
      // Kill any in-flight pulse on this element so back-to-back
      // upstream picks don't queue overlapping animations.
      gsap.killTweensOf(card);
      // The pulse: gold border + 1.5% scale up, then ease back. We
      // animate a `--km-pulse` custom property so CSS owns the visual
      // (border colour) and we don't fight inline styles set elsewhere.
      gsap.fromTo(
        card,
        { "--km-pulse": 0, scale: 1 },
        {
          duration: 0.3,
          "--km-pulse": 1,
          scale: 1.015,
          ease: "power2.out",
          onComplete: () => {
            gsap.to(card, {
              duration: 0.3,
              "--km-pulse": 0,
              scale: 1,
              ease: "power2.inOut",
            });
          },
        },
      );
    }
  }, [cascaded]);
}

/** Minimal CSS.escape polyfill, only the characters we actually use in
 *  match ids (alphanumeric + underscore + dash). */
function cssEscape(input: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(input);
  }
  return input.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}
