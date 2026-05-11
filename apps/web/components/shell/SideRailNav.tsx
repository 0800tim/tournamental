"use client";

/**
 * Desktop side-rail navigation — visible at >=768px viewports.
 * Houses the same primary destinations as the mobile bottom nav plus a
 * secondary section for Leaderboard / Syndicates / Open source / Settings.
 *
 * Uses `window.location.pathname` (post-mount) instead of
 * `usePathname()` so static-prerender pages don't trip the navigation
 * context.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  HomeIcon,
  PredictIcon,
  WatchIcon,
  ProfileIcon,
  TrophyIcon,
  GroupsIcon,
  CodeIcon,
  SettingsIcon,
} from "./icons";

export interface SideRailLink {
  readonly label: string;
  readonly href: string;
  readonly icon: React.ReactNode;
  readonly matchPrefix?: string;
  readonly external?: boolean;
}

export const DEFAULT_PRIMARY_LINKS: readonly SideRailLink[] = [
  { label: "Home", href: "/", icon: <HomeIcon /> },
  {
    label: "Predict",
    href: "/world-cup-2026",
    icon: <PredictIcon />,
    matchPrefix: "/world-cup-2026",
  },
  { label: "Watch", href: "/watch", icon: <WatchIcon />, matchPrefix: "/watch" },
  {
    label: "Profile",
    href: "/profile",
    icon: <ProfileIcon />,
    matchPrefix: "/profile",
  },
];

export const DEFAULT_SECONDARY_LINKS: readonly SideRailLink[] = [
  {
    label: "Leaderboard",
    href: "/leaderboard",
    icon: <TrophyIcon />,
    matchPrefix: "/leaderboard",
  },
  {
    label: "Syndicates",
    href: "/syndicates",
    icon: <GroupsIcon />,
    matchPrefix: "/syndicates",
  },
  {
    label: "Open source",
    href: "https://github.com/0800tim/tournamental",
    icon: <CodeIcon />,
    external: true,
  },
  {
    label: "Settings",
    href: "/settings",
    icon: <SettingsIcon />,
    matchPrefix: "/settings",
  },
];

export interface SideRailNavProps {
  readonly primary?: readonly SideRailLink[];
  readonly secondary?: readonly SideRailLink[];
}

export function SideRailNav({
  primary = DEFAULT_PRIMARY_LINKS,
  secondary = DEFAULT_SECONDARY_LINKS,
}: SideRailNavProps) {
  const [pathname, setPathname] = useState<string>("/");
  useEffect(() => {
    if (typeof window === "undefined") return;
    setPathname(window.location.pathname || "/");
    const onPop = () => setPathname(window.location.pathname || "/");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return (
    <aside className="vt-siderail" aria-label="Primary navigation">
      <Link href="/" className="vt-siderail-brand">
        <span className="vt-siderail-brand-mark" aria-hidden="true">
          T
        </span>
        Tournamental
      </Link>
      {primary.map((link) => (
        <RailLink key={link.href} link={link} pathname={pathname} />
      ))}
      <div className="vt-siderail-section">More</div>
      {secondary.map((link) => (
        <RailLink key={link.href} link={link} pathname={pathname} />
      ))}
    </aside>
  );
}

function RailLink({
  link,
  pathname,
}: {
  link: SideRailLink;
  pathname: string;
}) {
  const isActive = link.matchPrefix
    ? pathname.startsWith(link.matchPrefix)
    : pathname === link.href;
  if (link.external) {
    return (
      <a
        href={link.href}
        className="vt-siderail-link"
        target="_blank"
        rel="noreferrer"
      >
        {link.icon}
        {link.label}
      </a>
    );
  }
  return (
    <Link
      href={link.href}
      className="vt-siderail-link"
      aria-current={isActive ? "page" : undefined}
    >
      {link.icon}
      {link.label}
    </Link>
  );
}
