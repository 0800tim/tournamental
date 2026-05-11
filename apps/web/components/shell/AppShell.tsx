"use client";

/**
 * AppShell, the shared chrome around every shelled page.
 *
 * Renders:
 *   - top app-bar with brand logo (left) + hamburger menu (right)
 *   - main content area (children)
 *   - bottom nav on mobile (unless `showBottomNav={false}`)
 *   - microsite sub-nav (auto-mounted for /world-cup-2026/* paths,
 *     or passed explicitly via `subHeader`)
 *   - slide-in app-menu drawer, triggered by the hamburger or the
 *     bottom-nav "Menu" tab. The drawer is available on every viewport
 *     size, there is no longer a separate desktop side rail.
 *   - install-prompt toast (once per device)
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
import { InstallPrompt } from "./InstallPrompt";
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
}: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [autoSubNav, setAutoSubNav] = useState<ReactNode>(null);

  useEffect(() => {
    if (subHeader || suppressMicrositeNav) return;
    if (typeof window === "undefined") return;
    const p = window.location.pathname || "";
    if (p.startsWith("/world-cup-2026")) {
      setAutoSubNav(<MicrositeSubNav />);
    }
  }, [subHeader, suppressMicrositeNav]);

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
      />
      {resolvedSubHeader ? (
        <div className="vt-page-header">{resolvedSubHeader}</div>
      ) : null}
      <main className="vt-shell-main" id="main">
        {children}
      </main>
      {showBottomNav ? (
        <BottomNav
          tabs={bottomNavTabs}
          onMenuClick={() => setMenuOpen(true)}
        />
      ) : null}
      <AppMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
      <InstallPrompt />
    </div>
  );
}
