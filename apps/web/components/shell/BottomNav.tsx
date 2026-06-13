"use client";

/**
 * Mobile bottom navigation bar, FIFA-style 4 (or 5) tab affordance.
 *
 * - 4 main destinations: Home / Predict / Watch / Profile.
 * - Optional centre raised "Syndicates" (`+`-style) tab when
 *   `withCenterAction` is true. Disabled by default for v0.1.
 * - Hides on scroll-down, reveals on scroll-up. Honours
 *   `prefers-reduced-motion` (no transform animation when set).
 * - Hidden on >=768px viewports (desktop relies on the top-right
 *   hamburger button to open the menu drawer instead).
 *
 * The active tab is computed from `window.location.pathname` once the
 * component mounts. We deliberately avoid `usePathname()` here because
 * pages with `dynamic = "force-static"` cannot prerender it cleanly in
 * Next 14, the static-export RSC pass throws when the navigation
 * context isn't available.
 */

import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { track } from "@/lib/analytics";

function safeT(
  t: ReturnType<typeof useTranslations>,
  key: string,
  fallback: string,
): string {
  try {
    const out = t(key);
    if (out === key) return fallback;
    return out;
  } catch {
    return fallback;
  }
}

import {
  HomeIcon,
  PredictIcon,
  GroupsIcon,
  BarChartIcon,
  CalendarIcon,
  PlusIcon,
  MenuIcon,
} from "./icons";

export interface BottomNavTab {
  readonly label: string;
  /** Translation key in the messages catalogue. When present, consumers
   *  render the catalogue value and fall back to `label`. */
  readonly i18nKey?: string;
  readonly href: string;
  readonly icon: ReactNode;
  /** Match the route prefix instead of an exact path equality. */
  readonly matchPrefix?: string;
  /** Visually raised centre tab (the "+" pattern). */
  readonly raised?: boolean;
}

export interface BottomNavProps {
  readonly tabs?: readonly BottomNavTab[];
  /** Hide on scroll-down auto-hide. Defaults to true. */
  readonly autoHide?: boolean;
  /** Optional handler, when provided, appends a "Menu" tab that
   *  opens the mobile drawer instead of navigating. */
  readonly onMenuClick?: () => void;
}

export const DEFAULT_BOTTOM_NAV_TABS: readonly BottomNavTab[] = [
  { label: "Home", i18nKey: "nav.home", href: "/", icon: <HomeIcon /> },
  {
    // Tim 2026-06-03: short "Play" in the dock; the desktop/drawer
    // nav uses the longer "Play (Predict)" via nav.predict.
    label: "Play",
    i18nKey: "nav.play",
    href: "/world-cup-2026",
    icon: <PredictIcon />,
    matchPrefix: "/world-cup-2026",
  },
  // Tim 2026-06-13: Pools tab swapped for Schedule now that the
  // tournament is in flight. The calendar surface is the primary
  // daily destination (pickable, with live scores), and Pools +
  // Leaderboard are effectively the same audience-side view; few
  // people will start a new pool mid-tournament. Pools is still
  // one tap away from the side-drawer.
  {
    label: "Schedule",
    i18nKey: "nav.schedule",
    href: "/world-cup-2026/calendar",
    icon: <CalendarIcon />,
    matchPrefix: "/world-cup-2026/calendar",
  },
  // Tim 2026-06-12: Profile drops out of the dock; Leaderboard takes
  // its slot with the bar-chart icon. The profile is still reachable
  // from the side-drawer 'My Profile' entry and the avatar chip at
  // the top of the app bar.
  {
    label: "Leaderboard",
    i18nKey: "nav.leaderboard",
    href: "/leaderboard",
    icon: <BarChartIcon />,
    matchPrefix: "/leaderboard",
  },
];

export function BottomNav({
  tabs = DEFAULT_BOTTOM_NAV_TABS,
  autoHide = true,
  onMenuClick,
}: BottomNavProps) {
  const t = useTranslations();
  const [pathname, setPathname] = useState<string>("/");
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setPathname(window.location.pathname || "/");
    const onPop = () => setPathname(window.location.pathname || "/");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!autoHide) return undefined;
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return undefined;

    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - lastY.current;
      // Ignore tiny jitters; only react to >6px deltas.
      if (Math.abs(dy) < 6) return;
      // Always show near the top.
      if (y < 80) {
        setHidden(false);
      } else if (dy > 0) {
        setHidden(true);
      } else {
        setHidden(false);
      }
      lastY.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [autoHide]);

  const totalCols = tabs.length + (onMenuClick ? 1 : 0);
  return (
    <nav
      className="vt-bottomnav"
      data-hidden={hidden ? "1" : "0"}
      style={
        {
          "--vt-bottomnav-cols": String(totalCols),
        } as React.CSSProperties
      }
      aria-label="Primary"
    >
      {tabs.map((tab) => {
        const isActive = isTabActive(tab, pathname);
        const label = tab.i18nKey ? safeT(t, tab.i18nKey, tab.label) : tab.label;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="vt-bottomnav-tab"
            aria-current={isActive ? "page" : undefined}
            data-raised={tab.raised ? "1" : undefined}
            onClick={() => {
              track("nav.tab.changed", {
                label: tab.label,
                href: tab.href,
                surface: "bottomnav",
              });
            }}
          >
            <span className="vt-bottomnav-icon">{tab.icon}</span>
            <span>{label}</span>
          </Link>
        );
      })}
      {onMenuClick ? (
        <button
          type="button"
          className="vt-bottomnav-tab vt-bottomnav-tab-menu"
          onClick={() => {
            track("nav.menu.opened", { surface: "bottomnav" });
            onMenuClick();
          }}
          aria-label={safeT(t, "nav.open_menu", "Open menu")}
          aria-haspopup="dialog"
        >
          <span className="vt-bottomnav-icon"><MenuIcon /></span>
          <span>{safeT(t, "nav.menu", "Menu")}</span>
        </button>
      ) : null}
    </nav>
  );
}

export function isTabActive(tab: BottomNavTab, pathname: string): boolean {
  if (tab.matchPrefix) {
    return pathname.startsWith(tab.matchPrefix);
  }
  // Exact-match for "/" so the home tab doesn't claim every route.
  return pathname === tab.href;
}
