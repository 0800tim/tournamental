"use client";

/**
 * Keeps `<meta name="theme-color">` in sync with the data-theme on
 * <html>. Browsers use this for the title-bar tint on Android and the
 * status-bar tint on iOS PWAs. Watches `prefers-color-scheme` and the
 * data-theme attribute (so a user toggling theme updates the meta tag
 * instantly).
 */

import { useEffect } from "react";

const DARK = "#0a0e1a";
const LIGHT = "#f5f7fc";

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

function detect(): "dark" | "light" {
  if (typeof document === "undefined") return "dark";
  const data = document.documentElement.dataset.theme;
  if (data === "light") return "light";
  if (data === "dark") return "dark";
  // No explicit theme set — follow the OS.
  if (typeof window !== "undefined" && window.matchMedia) {
    if (window.matchMedia("(prefers-color-scheme: light)").matches)
      return "light";
  }
  return "dark";
}

export function ThemeMeta() {
  useEffect(() => {
    const sync = () => {
      applyMeta(detect() === "light" ? LIGHT : DARK);
    };
    sync();

    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    const onChange = () => sync();
    media?.addEventListener?.("change", onChange);

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      media?.removeEventListener?.("change", onChange);
      observer.disconnect();
    };
  }, []);
  return null;
}
