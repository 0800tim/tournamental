"use client";

/**
 * Page-view auto-fire hook.
 *
 * Next.js client-side navigations don't trigger a fresh GTM page-view -
 * GA4 still thinks it's the initial document load. This hook listens
 * to the App Router's `usePathname()` and fires a single
 * `page.view` event whenever the pathname changes.
 *
 * Mounted exactly once in <GtmRoot/>. Calling it twice from the tree
 * would double-count visits.
 */

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { track } from "./index";

export function usePageView(): void {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Honour SSR / pre-mount edge, pathname can be null before the
    // first effect runs.
    if (!pathname) return;
    track("page.view", {
      path: pathname,
      title: typeof document !== "undefined" ? document.title : null,
      host: typeof location !== "undefined" ? location.host : null,
      referrer:
        typeof document !== "undefined" ? document.referrer || null : null,
    });
  }, [pathname]);
}
