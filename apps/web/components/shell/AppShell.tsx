"use client";

/**
 * AppShell, the shared chrome around every shelled page.
 *
 * Renders:
 *   - top app-bar with brand logo (left) + hamburger menu (right);
 *     on desktop (>=768px) the bar grows by a second row containing
 *     primary nav links, a "More" dropdown, and an auth chip (see
 *     DesktopNav). Phone viewports keep the slim single-row bar.
 *   - main content area (children)
 *   - bottom nav on mobile (unless `showBottomNav={false}`)
 *   - microsite sub-nav (auto-mounted for /world-cup-2026/* paths,
 *     or passed explicitly via `subHeader`)
 *   - slide-in app-menu drawer, triggered by the hamburger or the
 *     bottom-nav "Menu" tab. The drawer is available on every viewport
 *     size and holds the full nav surface (the desktop bar only
 *     exposes the most-used primaries inline). The drawer also hosts
 *     the PWA install affordance (see InstallPrompt).
 *
 * Variants:
 *   - `"default"`, standard chrome.
 *   - `"canvas"`, main content is full-bleed under a translucent
 *     app-bar; bottom nav still renders by default (turn it off
 *     explicitly with `showBottomNav={false}` on routes that need
 *     true full-screen, e.g. the match renderer).
 */

import { useEffect, useState, type ReactNode } from "react";

import { AppBar, type AppBarAction } from "./AppBar";
import { AppMenuDrawer } from "./AppMenuDrawer";
import { BottomNav, type BottomNavTab } from "./BottomNav";
import { MicrositeSubNav } from "./MicrositeSubNav";
import { RegisterSW } from "./RegisterSW";
import { ThemeMeta } from "./ThemeMeta";

import "./shell.css";

export interface AppShellProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly rightAction?: AppBarAction;
  readonly showBottomNav?: boolean;
  readonly variant?: "default" | "canvas";
  readonly bottomNavTabs?: readonly BottomNavTab[];
  readonly className?: string;
  /** Optional content rendered between the app-bar and the main pane,
   *  typically a sticky pill-tabs strip. If undefined and the current
   *  path matches `/world-cup-2026/*`, the WC 2026 microsite sub-nav
   *  is auto-mounted. */
  readonly subHeader?: ReactNode;
  /** When true, do not auto-mount the microsite sub-nav even on a
   *  `/world-cup-2026/*` path. Use for full-bleed routes (the match
   *  renderer) that own their own chrome. */
  readonly suppressMicrositeNav?: boolean;
  /** When true, render only the main pane — no AppBar, no BottomNav,
   *  no sub-nav, no install prompt. Used by /world-cup-2026?embed=1
   *  so partner sites can iframe the bracket app as a fully-playable
   *  widget without duplicate chrome. */
  readonly embed?: boolean;
}

export function AppShell({
  title,
  children,
  rightAction,
  showBottomNav = true,
  variant = "default",
  bottomNavTabs,
  className,
  subHeader,
  suppressMicrositeNav,
  embed = false,
}: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [autoSubNav, setAutoSubNav] = useState<ReactNode>(null);

  useEffect(() => {
    if (embed || subHeader || suppressMicrositeNav) return;
    if (typeof window === "undefined") return;
    const p = window.location.pathname || "";
    if (p.startsWith("/world-cup-2026")) {
      setAutoSubNav(<MicrositeSubNav />);
    }
  }, [embed, subHeader, suppressMicrositeNav]);

  if (embed) {
    return (
      <div
        className={`vt-shell vt-shell-embed${className ? ` ${className}` : ""}`}
        data-variant={variant}
        data-embed="1"
      >
        <ThemeMeta />
        <main className="vt-shell-main" id="main">
          {children}
        </main>
      </div>
    );
  }

  const resolvedSubHeader = subHeader ?? autoSubNav;

  return (
    <div
      className={`vt-shell${className ? ` ${className}` : ""}`}
      data-variant={variant}
    >
      <ThemeMeta />
      <RegisterSW />
      <AppBar
        title={title}
        rightAction={rightAction}
        onMenuClick={() => setMenuOpen((o) => !o)}
        menuOpen={menuOpen}
        hideDesktopNav={variant === "canvas"}
      />
      {resolvedSubHeader ? (
        <div className="vt-page-header">{resolvedSubHeader}</div>
      ) : null}
      <main className="vt-shell-main" id="main">
        {children}
        {/* FIFA trademark disclaimer — Tim 2026-05-22. Nominative fair
         * use only; we surface the disclaimer site-wide so it sits on
         * every page that mentions the FIFA World Cup. */}
        <footer className="vt-shell-disclaimer" role="contentinfo">
          <p>
            Tournamental is independent and not affiliated with, endorsed
            by, or sponsored by FIFA. <strong>FIFA World Cup™</strong> and{" "}
            <strong>FIFA World Cup 2026™</strong> are trademarks of
            Fédération Internationale de Football Association.
          </p>
          <p className="vt-shell-disclaimer-links">
            <a href="/languages">Languages</a>
            <span aria-hidden> · </span>
            <a
              href="https://github.com/0800tim/tournamental/blob/main/docs/CONTRIBUTING-TRANSLATIONS.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              Translate
            </a>
            <span aria-hidden> · </span>
            <a
              href="https://github.com/0800tim/tournamental"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open source
            </a>
          </p>
        </footer>
      </main>
      {showBottomNav ? (
        <BottomNav
          tabs={bottomNavTabs}
          onMenuClick={() => setMenuOpen(true)}
        />
      ) : null}
      <AppMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}
