"use client";

/**
 * Keeps `<meta name="theme-color">` set for the play app. The play
 * surface is dark-only as of 2026-05-21 (see docs/BRAND.md §2), so this
 * component simply pins the charcoal canvas colour at mount. The
 * previous incarnation watched `prefers-color-scheme` and the
 * `data-theme` attribute to swap between dark and light shells; that
 * code has been removed because the shell no longer has a light theme.
 *
 * The bracket page (apps/web/app/world-cup-2026/page.tsx) still honours
 * `?theme=light` on its `<main class="bracket-page">` element for the
 * partner-iframe path, but that override is scoped per-page and does
 * not change the browser-chrome tint, so we keep the meta colour
 * pinned to the play canvas.
 */

import { useEffect } from "react";

const DARK = "#15151a";

function applyMeta(color: string) {
  if (typeof document === "undefined") return;
  let el = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!el) {
    el = document.createElement("meta");
    el.name = "theme-color";
    document.head.appendChild(el);
  }
  el.content = color;
}

export function ThemeMeta() {
  useEffect(() => {
    applyMeta(DARK);
  }, []);
  return null;
}
