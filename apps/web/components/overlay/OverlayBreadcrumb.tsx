/**
 * OverlayBreadcrumb, visible breadcrumb that mirrors the overlay
 * stack so the user always sees where they are: e.g.
 *
 *   Home › World Cup 2026 › NZL › NZL vs ARG
 *
 * The breadcrumb is rendered above the page chrome (or above the
 * AppBar when the PWA shell is active). Each crumb is a button that
 * pops the stack back to that depth, so tapping "World Cup 2026"
 * closes every overlay and returns to the underlying page.
 *
 * Renders nothing when no overlays are open.
 */

"use client";

import Link from "next/link";

import { useOptionalOverlay } from "./OverlayProvider";
import type { OverlayFrame } from "./types";

interface OverlayBreadcrumbProps {
  /** Label for the underlying page (left-most crumb). Default: "Home". */
  readonly pageLabel?: string;
  /** Underlying page href. Default: "/". */
  readonly pageHref?: string;
}

/** Compact human label for an overlay frame. */
function frameLabel(frame: OverlayFrame): string {
  switch (frame.kind) {
    case "team":
      return frame.params.code ?? "Team";
    case "match":
      return `Match ${frame.params.id ?? "?"}`;
    case "leaderboard-entry":
      return frame.params.name ?? "Bracket";
    default:
      return "Overlay";
  }
}

export function OverlayBreadcrumb(props: OverlayBreadcrumbProps) {
  const { pageLabel = "Home", pageHref = "/" } = props;
  const overlay = useOptionalOverlay();
  if (!overlay || overlay.stack.length === 0) return null;

  const popTo = (targetDepth: number): void => {
    // Pop frames until the stack length equals targetDepth.
    const toPop = overlay.stack.length - targetDepth;
    for (let i = 0; i < toPop; i += 1) overlay.close();
  };

  return (
    <nav
      className="vt-overlay-breadcrumb-stack"
      aria-label="Overlay breadcrumb"
      data-overlay-breadcrumb=""
    >
      <Link
        href={pageHref}
        className="vt-overlay-breadcrumb-crumb"
        onClick={(e) => {
          // Close all overlays when the user taps the page-level crumb;
          // the page itself doesn't need to navigate (we're already on it).
          e.preventDefault();
          overlay.closeAll();
        }}
      >
        {pageLabel}
      </Link>
      {overlay.stack.map((frame, i) => {
        const isLast = i === overlay.stack.length - 1;
        return (
          <span key={`${frame.kind}-${i}`} className="vt-overlay-breadcrumb-segment">
            <span className="vt-overlay-breadcrumb-sep" aria-hidden="true">
              ›
            </span>
            <button
              type="button"
              className="vt-overlay-breadcrumb-crumb"
              aria-current={isLast ? "page" : undefined}
              onClick={() => {
                if (isLast) return;
                popTo(i + 1);
              }}
            >
              {frameLabel(frame)}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
