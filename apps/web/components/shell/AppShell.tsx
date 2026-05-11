"use client";

/**
 * AppShell — the shared chrome around every shelled page.
 *
 * Renders:
 *   - top app-bar (always)
 *   - main content area (children)
 *   - bottom nav on mobile (unless `showBottomNav={false}`)
 *   - side rail on desktop (unless `showSideRail={false}`)
 *   - microsite sub-nav (auto-mounted for /world-cup-2026/* paths,
 *     or passed explicitly via `subHeader`)
 *   - full-screen mobile menu drawer triggered by avatar tap or
 *     bottom-nav Menu tab
 *   - install-prompt toast (once per device)
 *
 * Variants:
 *   - `"default"` — shifts main content right by 240px on desktop to
 *     make room for the side rail.
 *   - `"canvas"` — main content is full-bleed under a translucent
 *     app-bar; bottom nav still renders by default (turn it off
 *     explicitly with `showBottomNav={false}` on routes that need
 *     true full-screen, e.g. the match renderer).
 */

import { useEffect, useState, type ReactNode } from "react";

import { AppBar, type AppBarAction } from "./AppBar";
import { BottomNav, type BottomNavTab } from "./BottomNav";
import { InstallPrompt } from "./InstallPrompt";
import { MicrositeSubNav } from "./MicrositeSubNav";
import { MobileMenuDrawer } from "./MobileMenuDrawer";
import { RegisterSW } from "./RegisterSW";
import { SideRailNav, type SideRailLink } from "./SideRailNav";
import { ThemeMeta } from "./ThemeMeta";

import "./shell.css";

export interface AppShellProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly rightAction?: AppBarAction;
  readonly avatarInitials?: string;
  readonly avatarUrl?: string;
  readonly showBottomNav?: boolean;
  readonly showSideRail?: boolean;
  readonly variant?: "default" | "canvas";
  readonly bottomNavTabs?: readonly BottomNavTab[];
  readonly sideRailPrimary?: readonly SideRailLink[];
  readonly sideRailSecondary?: readonly SideRailLink[];
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
  avatarInitials,
  avatarUrl,
  showBottomNav = true,
  showSideRail = true,
  variant = "default",
  bottomNavTabs,
  sideRailPrimary,
  sideRailSecondary,
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
      {showSideRail && variant === "default" ? (
        <SideRailNav
          primary={sideRailPrimary}
          secondary={sideRailSecondary}
        />
      ) : null}
      <AppBar
        title={title}
        rightAction={rightAction}
        avatarInitials={avatarInitials}
        avatarUrl={avatarUrl}
        onAvatarClick={() => setMenuOpen(true)}
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
      <MobileMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
      <InstallPrompt />
    </div>
  );
}
