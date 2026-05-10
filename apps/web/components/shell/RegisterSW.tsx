"use client";

/**
 * Registers `/sw.js` with the browser's service-worker runtime once the
 * page has settled. No-op on browsers without service-worker support.
 * Only registers in production by default; opt-in via
 * `NEXT_PUBLIC_VTORN_SW_DEV=1` for development testing.
 */

import { useEffect } from "react";

export function RegisterSW() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    const isDev = process.env.NODE_ENV !== "production";
    const allowDev = process.env.NEXT_PUBLIC_VTORN_SW_DEV === "1";
    if (isDev && !allowDev) return;

    const ready = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // service-worker registration is best-effort; never throw.
      });
    };
    if (document.readyState === "complete") ready();
    else window.addEventListener("load", ready, { once: true });
  }, []);
  return null;
}
