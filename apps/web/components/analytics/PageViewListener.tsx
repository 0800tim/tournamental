"use client";

/**
 * Thin React component that wraps `usePageView()`. We split it out of
 * `<GtmRoot/>` so the hook lives behind the same `'use client'`
 * boundary and doesn't pull `next/navigation` into the SSR pass.
 *
 * Rendering: returns null. Purely an effects host.
 */

import { usePageView } from "@/lib/analytics/usePageView";

export function PageViewListener() {
  usePageView();
  return null;
}
