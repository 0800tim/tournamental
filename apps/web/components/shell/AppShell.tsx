"use client";

/**
 * AppShell — the shared chrome around every shelled page.
 *
 * Renders:
 *   - top app-bar (always)
 *   - main content area (children)
 *   - bottom nav on mobile (unless `showBottomNav={false}`)
 *   - side rail on desktop (unless `showSideRail={false}`)
 *   - install-prompt toast (once per device)
 *
 * The shell is a server component by default — child components opt
 * into client behaviour (`AppBar`, `BottomNav`, `SideRailNav`,
 * `InstallPrompt`, `RegisterSW`, `ThemeMeta` are all `"use client"`).
 *
 * Variants:
 *   - `"default"` — shifts main content right by 240px on desktop to
 *     make room for the side rail.
 *   - `"canvas"` — used by the renderer page; main content is full-bleed
 *     under a translucent app-bar; bottom nav is hidden.
 */

import type { ReactNode } from "react";

import { AppBar, type AppBarAction } from "./AppBar";
import { BottomNav, type BottomNavTab } from "./BottomNav";
import { InstallPrompt } from "./InstallPrompt";
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
   *  typically a sticky pill-tabs strip. */
  readonly subHeader?: ReactNode;
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
}: AppShellProps) {
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
      />
      {subHeader ? <div className="vt-page-header">{subHeader}</div> : null}
      <main className="vt-shell-main" id="main">
        {children}
      </main>
      {showBottomNav ? <BottomNav tabs={bottomNavTabs} /> : null}
      <InstallPrompt />
    </div>
  );
}
