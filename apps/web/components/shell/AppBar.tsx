"use client";

/**
 * Top app-bar — 56px tall sticky header used on every shelled page.
 *
 * Layout: brand logo (left, links to `/`) · title (centre) ·
 * optional page-level action + hamburger menu button (right).
 *
 * The hamburger is the single entry point to the app-menu drawer on
 * every viewport size. There is no longer a separate desktop side rail.
 *
 * Backdrop-blurs when the page scrolls; on canvas pages
 * (`variant="canvas"`) the bar floats over the renderer with translucent
 * blur and no opaque fill.
 */

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { MenuIcon } from "./icons";

export interface AppBarProps {
  readonly title: string;
  /** Optional right-side context action (e.g. share / info / chat).
   *  Renders to the LEFT of the hamburger when present. */
  readonly rightAction?: AppBarAction;
  /** Click handler for the hamburger menu button. When omitted, the
   *  button still renders but is disabled — keeps layout consistent. */
  readonly onMenuClick?: () => void;
  /** Whether the menu drawer is currently open. Used to flip the
   *  hamburger's aria-label between "Open menu" and "Close menu". */
  readonly menuOpen?: boolean;
  /** Optional initials shown inside the brand mark when no logo image is
   *  provided. Defaults to "T" (Tournamental). */
  readonly brandInitials?: string;
}

export interface AppBarAction {
  readonly label: string;
  readonly icon: ReactNode;
  readonly onClick: () => void;
}

export function AppBar({
  title,
  rightAction,
  onMenuClick,
  menuOpen = false,
  brandInitials = "T",
}: AppBarProps) {
  const [scrolled, setScrolled] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 4);
      lastY.current = y;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="vt-appbar"
      data-scrolled={scrolled ? "1" : "0"}
      data-has-action={rightAction ? "1" : "0"}
      role="banner"
    >
      <Link
        href="/"
        className="vt-appbar-brand"
        aria-label="Tournamental home"
      >
        <span className="vt-appbar-brand-mark" aria-hidden="true">
          {brandInitials}
        </span>
      </Link>
      <h1 className="vt-appbar-title" aria-live="polite">
        {title}
      </h1>
      <div className="vt-appbar-actions">
        {rightAction ? (
          <button
            type="button"
            className="vt-appbar-action"
            aria-label={rightAction.label}
            onClick={rightAction.onClick}
          >
            {rightAction.icon}
          </button>
        ) : null}
        <button
          type="button"
          className="vt-appbar-burger"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-haspopup="dialog"
          aria-expanded={menuOpen ? "true" : "false"}
          onClick={onMenuClick}
        >
          <MenuIcon />
        </button>
      </div>
    </header>
  );
}
