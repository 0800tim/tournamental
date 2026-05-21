/**
 * Canonical nav-link catalogue for the app shell.
 *
 * Both the mobile drawer (AppMenuDrawer) and the desktop horizontal nav
 * (DesktopNav) read from this module so there is a single source of
 * truth for labels, hrefs, and section grouping. When a new top-level
 * destination is added, drop it in here and the surfaces pick it up.
 *
 * Why split PRIMARY vs MORE: Tim's directive is that desktop users
 * should reach the 90%-use items in one click and tuck the long tail
 * behind a "More" dropdown. PRIMARY is what renders inline on desktop;
 * MORE is the dropdown. The mobile drawer renders everything regardless,
 * grouped by section, so PRIMARY/MORE here also doubles as the App vs
 * More section split in the drawer.
 *
 * Note: the drawer's "Profile" item is intentionally not in PRIMARY for
 * the desktop bar because the desktop bar has a dedicated profile chip
 * on the right side (see AuthChip).
 */

import type { ReactNode } from "react";

import {
  HomeIcon,
  PredictIcon,
  ProfileIcon,
  TrophyIcon,
  GroupsIcon,
  CodeIcon,
  ShareIcon,
} from "./icons";

export interface NavLink {
  readonly label: string;
  readonly href: string;
  readonly icon: ReactNode;
  readonly external?: boolean;
  /** Renders the row as a hierarchical child of the preceding entry —
   *  indented + smaller font in the drawer's CSS. */
  readonly subItem?: boolean;
  /** Optional explicit match prefix for active-route highlighting. When
   *  omitted, the surface uses `pathname === href || pathname.startsWith(href + "/")`. */
  readonly matchPrefix?: string;
}

/**
 * Inline desktop nav links — the items users hit 90% of the time.
 * Order matters; this is the visual order on the desktop bar.
 *
 * These also seed the drawer's "App" section (with Profile + Home
 * prepended via PRIMARY_DRAWER below, since the desktop bar has its own
 * profile chip and the brand mark already links home).
 */
// 2026-05-21: play app is bracket-only for the WC 2026 push — Molecule
// + Watch demo were promoted out of every player-facing surface (still
// available on the marketing site / dev for future tournaments).
export const PRIMARY_DESKTOP: readonly NavLink[] = [
  {
    label: "Predict",
    href: "/world-cup-2026",
    icon: <PredictIcon />,
    matchPrefix: "/world-cup-2026",
  },
  {
    label: "Save & share",
    href: "/world-cup-2026/save-share",
    icon: <ShareIcon />,
    matchPrefix: "/world-cup-2026/save-share",
  },
  {
    label: "Leaderboard",
    href: "/leaderboard",
    icon: <TrophyIcon />,
    matchPrefix: "/leaderboard",
  },
  // Pools (formerly "Syndicates") promoted to top-level — owner-run
  // prediction pools are the v0.2 launch surface (Tim 2026-05-22).
  {
    label: "Pools",
    href: "/syndicates",
    icon: <GroupsIcon />,
    matchPrefix: "/syndicates",
  },
];

/**
 * Desktop "More ▾" dropdown links — secondary destinations that don't
 * warrant inline real-estate but should still be one click away.
 */
export const MORE_DESKTOP: readonly NavLink[] = [
  // Home + Settings + Syndicates removed (Tim 2026-05-22): the logo
  // already links home, Settings was a stub, and Pools graduated to
  // the top-level inline nav.
  { label: "About Tournamental", href: "https://tournamental.com",              icon: <CodeIcon />, external: true },
  { label: "How it works",       href: "https://tournamental.com/how-it-works", icon: <CodeIcon />, external: true },
  { label: "API keys",           href: "/profile/api-keys",                     icon: <CodeIcon />, matchPrefix: "/profile/api-keys" },
  { label: "Engineering log",    href: "https://tournamental.com/engineering",  icon: <CodeIcon />, external: true },
  { label: "Open source",        href: "https://github.com/0800tim/tournamental", icon: <CodeIcon />, external: true },
];

/**
 * Drawer "App" section — same as PRIMARY_DESKTOP but with Home + Profile
 * bookends so the mobile surface still surfaces them prominently.
 */
export const DRAWER_PRIMARY: readonly NavLink[] = [
  { label: "Home",    href: "/",                icon: <HomeIcon />,    matchPrefix: "__never__" },
  { label: "Predict", href: "/world-cup-2026",  icon: <PredictIcon />, matchPrefix: "/world-cup-2026" },
  { label: "Profile", href: "/profile",         icon: <ProfileIcon />, matchPrefix: "/profile" },
];

/**
 * Drawer "World Cup 2026" section — microsite cross-links retained from
 * the original drawer layout. Molecule + Watch were removed for the
 * 2026 WC push (bracket-only focus).
 */
export const DRAWER_WC2026: readonly NavLink[] = [
  { label: "Bracket Prophet",       href: "/world-cup-2026",                                  icon: <PredictIcon />, matchPrefix: "/world-cup-2026" },
  { label: "Save & share",          href: "/world-cup-2026/save-share",                       icon: <ShareIcon />,    matchPrefix: "/world-cup-2026/save-share" },
];

/**
 * Drawer "More" section — everything else. Mirrors MORE_DESKTOP minus
 * the Home item (which lives in DRAWER_PRIMARY for the drawer), plus a
 * dedicated "Engineering log" entry that points at the marketing site's
 * tournamental.com/engineering surface. The engineering log is the
 * audience we want AI agents and human engineers to land on when they
 * tap the drawer's "More" section, so it sits above the catch-all
 * "Open source" GitHub link.
 */
export const DRAWER_SECONDARY: readonly NavLink[] = [
  { label: "Leaderboard",   href: "/leaderboard",     icon: <TrophyIcon />,  matchPrefix: "/leaderboard" },
  { label: "Pools",         href: "/syndicates",      icon: <GroupsIcon />,  matchPrefix: "/syndicates" },
  { label: "Create a pool", href: "/syndicates/new",  icon: <GroupsIcon />,  matchPrefix: "/syndicates/new", subItem: true },
  { label: "About Tournamental", href: "https://tournamental.com",              icon: <CodeIcon />, external: true },
  { label: "How it works",       href: "https://tournamental.com/how-it-works", icon: <CodeIcon />, external: true },
  { label: "Engineering log",    href: "https://tournamental.com/engineering",  icon: <CodeIcon />, external: true },
  { label: "Open source",        href: "https://github.com/0800tim/tournamental", icon: <CodeIcon />, external: true },
  // Settings removed (Tim 2026-05-22): the route was a stub.
];

/**
 * Determine whether a link is "active" for a given pathname. Used by
 * both the drawer and the desktop nav to draw the active-route accent.
 *
 * Logic:
 *   1. If link.matchPrefix === "__never__" return false.
 *   2. Otherwise use matchPrefix (or href stripped of #fragment) as base.
 *   3. Match if `pathname === base` OR `pathname.startsWith(base + "/")`.
 *      The trailing-slash guard prevents `/leaderboards` matching
 *      `/leaderboard`.
 *
 * 3D Molecule sits under /world-cup-2026/molecule which is also a
 * prefix-match for /world-cup-2026. Order callers must therefore prefer
 * the most-specific match. The current PRIMARY_DESKTOP order lists
 * Predict before 3D Molecule, but isLinkActive itself returns
 * independent booleans; callers pick the most-specific. In practice the
 * desktop nav simply highlights whichever matches and the CSS shows
 * both as active. We avoid that by giving each link its own explicit
 * matchPrefix that's longest-first per route family.
 */
export function isLinkActive(link: NavLink, pathname: string): boolean {
  const prefix = link.matchPrefix ?? stripHash(link.href);
  if (prefix === "__never__" || !prefix) return false;
  if (prefix === "/") return pathname === "/";
  if (pathname === prefix) return true;
  if (pathname.startsWith(prefix + "/")) return true;
  return false;
}

function stripHash(href: string): string {
  const i = href.indexOf("#");
  return i === -1 ? href : href.slice(0, i);
}

/**
 * Pick the most-specific active link for a given pathname from a list.
 * Useful when two links share a prefix family (e.g. Predict and 3D
 * Molecule both sit under /world-cup-2026). The desktop bar uses this
 * to ensure /world-cup-2026/molecule lights up "3D Molecule", not both.
 */
export function pickActiveLink(
  links: readonly NavLink[],
  pathname: string,
): NavLink | null {
  let best: NavLink | null = null;
  let bestLen = -1;
  for (const l of links) {
    if (!isLinkActive(l, pathname)) continue;
    const prefix = l.matchPrefix ?? stripHash(l.href);
    if (prefix.length > bestLen) {
      best = l;
      bestLen = prefix.length;
    }
  }
  return best;
}
