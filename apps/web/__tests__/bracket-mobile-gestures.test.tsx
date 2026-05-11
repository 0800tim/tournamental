/**
 * Mobile gesture tests for the bracket UI.
 *
 * jsdom can't simulate real multi-touch pinch events end-to-end -
 * `Touch` and proper `TouchEvent` constructors are absent, so we
 * verify each gesture's *side effect* in isolation:
 *
 *   - usePinchZoom: the wrapped target gets the right transform-origin
 *     and a `will-change: transform` hint after mount on a mobile
 *     viewport, and the target ref is wired so a pinch could apply
 *     `transform: scale(...)`.
 *   - vibrate(): calls navigator.vibrate when available, no-ops when
 *     prefers-reduced-motion is set, and fires the right pattern on
 *     group vs knockout picks.
 *   - useStickyGroupHeaders: the IntersectionObserver callback adds /
 *     removes `is-stuck` on the matching header when the sentinel
 *     intersection state flips.
 *
 * For full pinch/scroll/inertia behaviour, run the Playwright e2e
 * suite under `__tests__/e2e/` against a real browser.
 */

// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { loadFixtures2026 } from "@tournamental/bracket-engine";

import { BracketBuilder } from "../components/bracket/BracketBuilder";
import {
  HAPTIC,
  scrollIntoViewIfHidden,
  useStickyGroupHeaders,
  vibrate,
} from "../lib/bracket/mobile-gestures";

const tournament = loadFixtures2026();

// Force the gesture hooks to think we're on a mobile viewport for
// the duration of these tests. The hooks gate every effect on a
// `(max-width: 640px)` matchMedia check.
function mockMatchMedia(reducedMotion = false): void {
  const mql = (query: string): MediaQueryList => ({
    matches: query.includes("max-width") ? true : reducedMotion,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: mql,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  mockMatchMedia(false);
  // Reset the URL hash so a prior test's tab selection doesn't bleed in.
  if (typeof window !== "undefined") {
    window.history.replaceState(null, "", "/");
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* -----------------------------------------------------------------
 * Pinch-zoom container wiring
 * ----------------------------------------------------------------- */

describe("BracketBuilder, pinch-zoom container", () => {
  it("wraps the .km-grid in a .km-pinch-wrap container with transform-origin set", async () => {
    const { container } = render(<BracketBuilder tournament={tournament} />);
    // Switch to a knockout-round tab so the pinch-zoom grid mounts.
    fireEvent.click(screen.getByRole("tab", { name: /R32/ }));
    // Let the pinch-zoom effect run.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const wrap = container.querySelector(".km-pinch-wrap") as HTMLElement | null;
    const grid = container.querySelector(".km-grid") as HTMLElement | null;
    expect(wrap).not.toBeNull();
    expect(grid).not.toBeNull();
    // Hook sets transform-origin + will-change on the target ref.
    expect(grid!.style.transformOrigin).toMatch(/%/);
    expect(grid!.style.willChange).toBe("transform");
  });
});

/* -----------------------------------------------------------------
 * Haptic vibrate
 * ----------------------------------------------------------------- */

describe("vibrate()", () => {
  it("calls navigator.vibrate with the requested pattern", () => {
    const spy = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      writable: true,
      value: spy,
    });
    expect(vibrate(HAPTIC.pick)).toBe(true);
    expect(spy).toHaveBeenCalledWith(8);
  });

  it("passes through array patterns as a fresh array", () => {
    const spy = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      writable: true,
      value: spy,
    });
    vibrate(HAPTIC.cascadeResolved);
    expect(spy).toHaveBeenCalledWith([8, 30, 8]);
  });

  it("no-ops when prefers-reduced-motion: reduce", () => {
    mockMatchMedia(true);
    const spy = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      writable: true,
      value: spy,
    });
    expect(vibrate(HAPTIC.pick)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns false (no throw) when navigator.vibrate is missing", () => {
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    expect(vibrate(HAPTIC.pick)).toBe(false);
  });
});

describe("BracketBuilder, vibrates on pick", () => {
  it("fires the short pick pattern when a group outcome changes", () => {
    const spy = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      writable: true,
      value: spy,
    });
    const { container } = render(<BracketBuilder tournament={tournament} />);
    const groupACard = screen.getAllByText("Group A")[0]!.closest(
      ".bracket-group",
    ) as HTMLElement;
    const firstRow = groupACard.querySelector(".mpr-row") as HTMLElement;
    const homePick = firstRow.querySelector(
      ".mpr-pick-home",
    ) as HTMLButtonElement;
    fireEvent.click(homePick);
    expect(spy).toHaveBeenCalled();
    // The first call should be the short pick pattern.
    expect(spy.mock.calls[0]![0]).toBe(8);
    expect(container).toBeDefined();
  });
});

/* -----------------------------------------------------------------
 * Sticky group headers
 * ----------------------------------------------------------------- */

interface IOEntry {
  isIntersecting: boolean;
  boundingClientRect: { top: number };
  target: Element;
}

describe("useStickyGroupHeaders", () => {
  it("adds is-stuck when sentinel intersection flips out-of-view above the top", () => {
    let observerCb: ((entries: IOEntry[]) => void) | null = null;
    const observed: Element[] = [];
    class FakeIO {
      constructor(cb: (entries: IOEntry[]) => void) {
        observerCb = cb;
      }
      observe(el: Element): void {
        observed.push(el);
      }
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IOEntry[] {
        return [];
      }
    }
    (window as unknown as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
      FakeIO as unknown as typeof IntersectionObserver;

    function Harness(): React.ReactElement {
      const ref = useStickyGroupHeaders<HTMLDivElement>({
        headerSelector: ".bracket-group-head",
      });
      return (
        <div ref={ref}>
          <div className="bracket-group">
            <div className="bracket-group-head">Group A</div>
          </div>
        </div>
      );
    }

    const { container } = render(<Harness />);
    const header = container.querySelector(
      ".bracket-group-head",
    ) as HTMLElement;
    expect(header.classList.contains("is-stuck")).toBe(false);

    // Simulate the sentinel scrolling out of view above the top edge.
    expect(observerCb).not.toBeNull();
    expect(observed.length).toBe(1);
    act(() => {
      observerCb!([
        {
          isIntersecting: false,
          boundingClientRect: { top: -10 },
          target: observed[0]!,
        },
      ]);
    });
    expect(header.classList.contains("is-stuck")).toBe(true);

    // Simulate it scrolling back into view.
    act(() => {
      observerCb!([
        {
          isIntersecting: true,
          boundingClientRect: { top: 0 },
          target: observed[0]!,
        },
      ]);
    });
    expect(header.classList.contains("is-stuck")).toBe(false);
  });
});

/* -----------------------------------------------------------------
 * scrollIntoViewIfHidden
 * ----------------------------------------------------------------- */

describe("scrollIntoViewIfHidden", () => {
  it("calls scrollIntoView when the element is off-screen", () => {
    const el = document.createElement("div");
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
    el.getBoundingClientRect = (): DOMRect =>
      ({
        top: 5000,
        bottom: 5100,
        left: 0,
        right: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 5000,
        toJSON: () => ({}),
      }) as DOMRect;
    const result = scrollIntoViewIfHidden(el);
    expect(result).toBe(true);
    expect(el.scrollIntoView).toHaveBeenCalled();
  });

  it("returns false (no scroll) when the element is already visible", () => {
    const el = document.createElement("div");
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
    el.getBoundingClientRect = (): DOMRect =>
      ({
        top: 100,
        bottom: 200,
        left: 0,
        right: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;
    const result = scrollIntoViewIfHidden(el);
    expect(result).toBe(false);
    expect(el.scrollIntoView).not.toHaveBeenCalled();
  });
});
