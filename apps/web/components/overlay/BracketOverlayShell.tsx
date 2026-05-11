/**
 * BracketOverlayShell, client wrapper that stitches the overlay
 * provider, the breadcrumb, the overlay root, and the page children
 * together. Lives as a separate component so the page itself stays a
 * server component (and so other pages can reuse the same shell).
 *
 * Layout:
 *
 *   <OverlayProvider>
 *     <OverlayBreadcrumb />     ← visible only when overlays are open
 *     {children}                ← the page itself (bracket / share / ...)
 *     <OverlayRoot />           ← portal-style overlay surface
 *   </OverlayProvider>
 */

"use client";

import type { ReactNode } from "react";

import { OverlayBreadcrumb } from "./OverlayBreadcrumb";
import { OverlayProvider } from "./OverlayProvider";
import { OverlayRoot } from "./OverlayRoot";

interface BracketOverlayShellProps {
  readonly children: ReactNode;
  readonly pageLabel?: string;
  readonly pageHref?: string;
}

export function BracketOverlayShell(props: BracketOverlayShellProps) {
  const { children, pageLabel, pageHref } = props;
  return (
    <OverlayProvider>
      <OverlayBreadcrumb pageLabel={pageLabel} pageHref={pageHref} />
      {children}
      <OverlayRoot />
    </OverlayProvider>
  );
}
