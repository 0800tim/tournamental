"use client";

/**
 * EmbedHeightReporter, a no-op DOM nothing-render that posts the current
 * document scroll height to the parent window whenever it changes.
 *
 * Used inside `/world-cup-2026?embed=1` (the iframe payload of the
 * partner-site widget) so the host widget can auto-size its `<iframe>`
 * and avoid an inner scrollbar. The widget filters incoming messages
 * by `type === "tnm:resize"`.
 *
 * Why ResizeObserver on `documentElement` rather than `body`: the body
 * collapses to its child grid in some flex/grid layouts and underreports
 * the content height. `documentElement.scrollHeight` is the union of
 * everything the browser would scroll, which is exactly what we want
 * the parent iframe sized to.
 *
 * We also re-emit on `load`, on every animation frame for the first
 * second (covers async hydration that doesn't trigger ResizeObserver),
 * and via a MutationObserver so attribute flips (data-tab, etc.) that
 * change visible height are picked up.
 */

import { useEffect } from "react";

const MESSAGE_TYPE = "tnm:resize";

function getDocHeight(): number {
  const d = document;
  const h = Math.max(
    d.documentElement.scrollHeight,
    d.body?.scrollHeight ?? 0,
    d.documentElement.offsetHeight,
    d.body?.offsetHeight ?? 0,
  );
  return Math.ceil(h);
}

export function EmbedHeightReporter(): null {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.parent === window) return; // not in an iframe

    let lastSent = -1;
    const send = (): void => {
      const h = getDocHeight();
      if (h === lastSent || h <= 0) return;
      lastSent = h;
      try {
        window.parent.postMessage({ type: MESSAGE_TYPE, height: h }, "*");
      } catch {
        /* parent origin denied; nothing we can do */
      }
    };

    send();

    const ro = new ResizeObserver(() => send());
    ro.observe(document.documentElement);
    if (document.body) ro.observe(document.body);

    const mo = new MutationObserver(() => send());
    mo.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });

    // Catch fonts/images that load after first paint and shift the
    // bottom of the page. Cheap: rAF-throttled to ≈10 ticks/sec for 2s.
    let frames = 0;
    let raf: number | null = null;
    const tick = (): void => {
      send();
      frames += 1;
      if (frames > 20) {
        raf = null;
        return;
      }
      raf = window.requestAnimationFrame(() => {
        window.setTimeout(tick, 100);
      });
    };
    raf = window.requestAnimationFrame(tick);

    const onLoad = (): void => send();
    window.addEventListener("load", onLoad);

    return () => {
      ro.disconnect();
      mo.disconnect();
      if (raf !== null) window.cancelAnimationFrame(raf);
      window.removeEventListener("load", onLoad);
    };
  }, []);
  return null;
}
