"use client";

/**
 * Top app-bar, 56px tall sticky header used on every shelled page.
 * Layout: brand (left) · title (centre) · hamburger or right-action (right).
 *
 * Backdrop-blurs when the page scrolls; on canvas pages
 * (`variant="canvas"`) the bar floats over the renderer with translucent
 * blur and no opaque fill.
 */

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface AppBarProps {
  readonly title: string;
  /** Right-side context action, typically share / info / chat. When
   *  provided this takes precedence over the hamburger. */
  readonly rightAction?: AppBarAction;
  /** Click handler for the hamburger menu button on the right. */
  readonly onMenuClick?: () => void;
  /** Reflects drawer open state so the hamburger can animate. */
  readonly menuOpen?: boolean;
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
  menuOpen,
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
      role="banner"
    >
      <Link
        href="/"
        className="vt-appbar-brand"
        aria-label="Tournamental home"
      >
        <span className="vt-appbar-brand-mark" aria-hidden="true">T</span>
      </Link>
      <h1 className="vt-appbar-title" aria-live="polite">
        {title}
      </h1>
      {rightAction ? (
        <button
          type="button"
          className="vt-appbar-action"
          aria-label={rightAction.label}
          onClick={rightAction.onClick}
        >
          {rightAction.icon}
        </button>
      ) : onMenuClick ? (
        <button
          type="button"
          className="vt-appbar-action vt-appbar-menu"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen ? "true" : "false"}
          data-open={menuOpen ? "1" : "0"}
          onClick={onMenuClick}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {menuOpen ? (
              <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </>
            ) : (
              <>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            )}
          </svg>
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
    </header>
  );
}
