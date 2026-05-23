"use client";

/**
 * Top app-bar, sticky header used on every shelled page.
 *
 * Layout has two rows that stack on the desktop and collapse to one on
 * phones:
 *
 *   Row 1 (always visible)
 *     brand (left) · title (centre) · hamburger or right-action (right)
 *
 *   Row 2 (desktop only, hidden via CSS below 768px)
 *     primary inline nav links · "More ▾" dropdown · auth chip
 *
 * On mobile the second row is `display: none` so the AppBar stays a
 * single 56px-tall band and page content doesn't shift. On desktop the
 * AppBar grows by the height of the nav row (~48px) and the
 * `--vt-shell-appbar-h` custom property accounts for that automatically
 * via the `data-with-desktop-nav` attribute.
 *
 * Backdrop-blurs when the page scrolls; on canvas pages
 * (`variant="canvas"`) the bar floats over the renderer with translucent
 * blur and no opaque fill.
 */

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { AuthChip } from "./AuthChip";
import { DesktopNav } from "./DesktopNav";

export interface AppBarProps {
  readonly title: string;
  /** Right-side context action, typically share / info / chat. When
   *  provided this takes precedence over the hamburger. */
  readonly rightAction?: AppBarAction;
  /** Click handler for the hamburger menu button on the right. */
  readonly onMenuClick?: () => void;
  /** Reflects drawer open state so the hamburger can animate. */
  readonly menuOpen?: boolean;
  /** When true, suppress the desktop nav row (used by `variant="canvas"`
   *  pages that want a minimal floating bar). Defaults to false. */
  readonly hideDesktopNav?: boolean;
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
  hideDesktopNav,
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
      data-with-desktop-nav={hideDesktopNav ? "0" : "1"}
      role="banner"
    >
      <div className="vt-appbar-row vt-appbar-row-main">
        <Link
          href="/"
          className="vt-appbar-brand"
          aria-label="Tournamental, homepage"
        >
          {/* `?v=ball` is a cache-buster, the brand mark was a sky-blue
           * "V" letter on a square chip until 2026-05-20. Without the
           * version param, browsers that cached the old asset still
           * render it. New visitors get the file the URL points at. */}
          <img
            src="/icons/icon-192.png?v=ball"
            alt=""
            width="28"
            height="28"
            decoding="async"
            className="vt-appbar-brand-mark"
          />
          <span className="vt-appbar-wordmark vt-wordmark" aria-hidden="true">
            Tournamental <span className="vt-appbar-wordmark-sub">FWC2026</span>
          </span>
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
          <>
            {/* Mobile-only auth chip sits LEFT of the hamburger so a
              * signed-in user can tap to /profile in one move and a
              * guest gets a small gold sign-in pill (Tim 2026-05-22).
              * The DesktopNav on >= 768px has its own AuthChip in the
              * right rail; this duplicate is hidden via the media
              * query in shell.css.
              *
              * The LocalePicker used to sit here too -- it was forcing
              * the wordmark to truncate and pushed the hamburger to a
              * second row on narrow phones (Tim 2026-05-23 screenshot).
              * Moved entirely into AppMenuDrawer; it already renders
              * the variant="drawer" picker there. */}
            <span className="vt-appbar-auth-mobile" aria-hidden={false}>
              <AuthChip />
            </span>
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
          </>
        ) : (
          <span aria-hidden="true" />
        )}
      </div>
      {hideDesktopNav ? null : <DesktopNav />}
    </header>
  );
}
