/**
 * OverlayLink — a `next/link` superset that can either:
 *
 *   1. Open a target route as an overlay (default when `as="overlay"`),
 *      preserving the underlying page route + appending the overlay
 *      params to the URL via `useOverlay().open()`.
 *
 *   2. Hard-navigate to the target route (default when `as="link"` or
 *      when the user holds Cmd/Ctrl/Shift, or middle-clicks — every
 *      escape-hatch a browser provides for "open in new tab").
 *
 * Why both modes? Tim's spec: bracket interactions should overlay the
 * card on top of the bracket, but Cmd-click / right-click /
 * "open in new tab" must always hit the underlying real route so the
 * URL is shareable + crawlable + bookmarkable. We never want to
 * silently swallow a Cmd-click.
 *
 * Usage:
 *   <OverlayLink href="/team/NZL" overlayKind="team" overlayParams={{ code: "NZL" }}>
 *     New Zealand
 *   </OverlayLink>
 *
 * If no `<OverlayProvider>` is present (e.g. on the marketing site or
 * SSR), OverlayLink degrades to a regular `next/link`.
 */

"use client";

import Link, { type LinkProps } from "next/link";
import { forwardRef, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

import { useOptionalOverlay } from "./OverlayProvider";
import type { OverlayKind } from "./types";

type AnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">;

export interface OverlayLinkProps extends AnchorProps {
  /** Underlying real route — what Cmd-click / right-click navigates to. */
  readonly href: LinkProps["href"];
  /** Overlay kind to open on plain click. Required when `as="overlay"`. */
  readonly overlayKind?: OverlayKind;
  /** Params for the overlay frame. */
  readonly overlayParams?: Record<string, string>;
  /**
   * Behavioural mode:
   *   - "overlay" (default if `overlayKind` is set) — plain click opens
   *     the overlay; mod-click navigates to `href`.
   *   - "link" (default if `overlayKind` is unset) — always navigates,
   *     identical to `next/link`.
   */
  readonly as?: "overlay" | "link";
  /** Children. */
  readonly children: ReactNode;
  /** Optional `next/link` extras passed through. */
  readonly prefetch?: LinkProps["prefetch"];
  readonly replace?: LinkProps["replace"];
  readonly scroll?: LinkProps["scroll"];
}

function isModifiedClick(e: MouseEvent<HTMLAnchorElement>): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
}

export const OverlayLink = forwardRef<HTMLAnchorElement, OverlayLinkProps>(
  function OverlayLink(props, ref) {
    const {
      href,
      overlayKind,
      overlayParams,
      as,
      onClick,
      children,
      prefetch,
      replace,
      scroll,
      ...rest
    } = props;
    const overlay = useOptionalOverlay();
    const mode: "overlay" | "link" = as ?? (overlayKind ? "overlay" : "link");

    const handleClick = (e: MouseEvent<HTMLAnchorElement>): void => {
      // Always let the consumer react first.
      onClick?.(e);
      if (e.defaultPrevented) return;
      if (mode !== "overlay" || !overlayKind || !overlay) return;
      if (isModifiedClick(e)) return; // Cmd / Ctrl / middle-click → hard nav
      e.preventDefault();
      overlay.open(overlayKind, overlayParams ?? {});
    };

    return (
      <Link
        ref={ref}
        href={href}
        prefetch={prefetch}
        replace={replace}
        scroll={scroll}
        onClick={handleClick}
        {...rest}
      >
        {children}
      </Link>
    );
  },
);
