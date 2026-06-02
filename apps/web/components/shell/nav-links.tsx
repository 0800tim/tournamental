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
  MoleculeIcon,
} from "./icons";

export interface NavLink {
  /** English fallback label. Always present so a missing translation
   *  doesn't render an empty pill. */
  readonly label: string;
  /** Translation key in the messages catalogue. When present, consumers
   *  should render `t(i18nKey)` and fall back to `label` only if the
   *  translator hook isn't available. */
  readonly i18nKey: string;
  readonly href: string;
  readonly icon: ReactNode;
  readonly external?: boolean;
  /** Renders the row as a hierarchical child of the preceding entry —
   *  indented + smaller font in the drawer's CSS. */
  readonly subItem?: boolean;
  /** Optional explicit match prefix for active-route highlighting. When
   *  omitted, the surface uses `pathname === href || pathname.startsWith(href + "/")`. */
  readonly matchPrefix?: string;
  /** Renders the link with the Tournamental gold call-to-action
   *  treatment (gold fill, dark text). Used to make the "Play" entry
   *  pop on the desktop nav. Drawer + mobile dock ignore this flag -
   *  the dock has its own emphasis pattern (raised tab) and the
   *  drawer reads better as a flat list. Tim 2026-06-03. */
  readonly emphasis?: "gold";
}

/**
 * Inline desktop nav links — the items users hit 90% of the time.
 * Order matters; this is the visual order on the desktop bar.
 *
 * These also seed the drawer's "App" section (with Profile + Home
 * prepended via PRIMARY_DRAWER below, since the desktop bar has its own
 * profile chip and the brand mark already links home).
 */
// 2026-05-22: Molecule restored to the inline desktop nav alongside Predict
// — it's a distinctive showcase surface (3D atom map of the user's bracket)
// and worth a top-level entry. Watch demo stays absent for the WC 2026 push.
// Order matters here: Predict must come before Molecule so the active-state
// resolver picks the deeper /world-cup-2026/molecule match for that route.
export const PRIMARY_DESKTOP: readonly NavLink[] = [
  {
    // Tim 2026-06-03: "Play (Predict)" reads more inviting to new
    // visitors than the bare verb "Predict". Bottom-nav still uses
    // the short "Play" form (see DEFAULT_BOTTOM_NAV_TABS). On desktop
    // only this gets the gold-fill emphasis so it pops as the primary
    // call-to-action in the top bar.
    label: "Play (Predict)",
    i18nKey: "nav.predict",
    // /world-cup-2026/molecule starts with /world-cup-2026 so we have to
    // pin Predict's match to the exact root + non-molecule subpaths to
    // avoid both links lighting up on the molecule route.
    href: "/world-cup-2026",
    icon: <PredictIcon />,
    matchPrefix: "/world-cup-2026",
    emphasis: "gold",
  },
  {
    label: "Molecule",
    i18nKey: "nav.molecule",
    href: "/world-cup-2026/molecule",
    icon: <MoleculeIcon />,
    matchPrefix: "/world-cup-2026/molecule",
  },
  {
    label: "Save & share",
    i18nKey: "nav.save_share",
    href: "/world-cup-2026/save-share",
    icon: <ShareIcon />,
    matchPrefix: "/world-cup-2026/save-share",
  },
  {
    label: "Leaderboard",
    i18nKey: "nav.leaderboard",
    href: "/leaderboard",
    icon: <TrophyIcon />,
    matchPrefix: "/leaderboard",
  },
  // Pools (formerly "Syndicates") promoted to top-level — owner-run
  // prediction pools are the v0.2 launch surface (Tim 2026-05-22).
  {
    label: "Pools",
    i18nKey: "nav.pools",
    href: "/pools",
    icon: <GroupsIcon />,
    matchPrefix: "/pools",
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
  { label: "About Tournamental", i18nKey: "nav.about", href: "https://tournamental.com",              icon: <CodeIcon />, external: true },
  { label: "How it works",       i18nKey: "nav.how_it_works", href: "https://tournamental.com/how-it-works", icon: <CodeIcon />, external: true },
  { label: "API keys",           i18nKey: "nav.api_keys", href: "/profile/api-keys",                     icon: <CodeIcon />, matchPrefix: "/profile/api-keys" },
  { label: "Engineering log",    i18nKey: "nav.engineering_log", href: "https://tournamental.com/engineering",  icon: <CodeIcon />, external: true },
  { label: "Open source",        i18nKey: "nav.open_source", href: "https://github.com/0800tim/tournamental", icon: <CodeIcon />, external: true },
];

/**
 * Drawer "App" section — every player-facing destination, in the order
 * Tim wireframed on 2026-05-22:
 *   Home → Predict → 3D Molecule → Leaderboard → Pools → Profile → Share & Save
 *
 * The Profile entry's label flips between "My Profile" and "Sign up / in"
 * inside AppMenuDrawer based on auth status; we keep the canonical entry
 * here so the renderer always has a stable href + icon to draw.
 */
export const DRAWER_PRIMARY: readonly NavLink[] = [
  { label: "Home",             i18nKey: "nav.home",            href: "/",                          icon: <HomeIcon />,     matchPrefix: "__never__" },
  { label: "Play (Predict)",    i18nKey: "nav.predict_bracket", href: "/world-cup-2026",           icon: <PredictIcon />,  matchPrefix: "/world-cup-2026" },
  { label: "3D Molecule",      i18nKey: "nav.molecule_3d",     href: "/world-cup-2026/molecule",   icon: <MoleculeIcon />, matchPrefix: "/world-cup-2026/molecule" },
  { label: "Leaderboard",      i18nKey: "nav.leaderboard",     href: "/leaderboard",               icon: <TrophyIcon />,   matchPrefix: "/leaderboard" },
  { label: "Pools",            i18nKey: "nav.pools",           href: "/syndicates",                icon: <GroupsIcon />,   matchPrefix: "/syndicates" },
  { label: "My Profile",       i18nKey: "nav.profile_my",      href: "/profile",                   icon: <ProfileIcon />,  matchPrefix: "/profile" },
  { label: "Share & Save",     i18nKey: "nav.share_save",      href: "/world-cup-2026/save-share", icon: <ShareIcon />,    matchPrefix: "/world-cup-2026/save-share" },
];

/**
 * Drawer "Tournamental" section — about/external links only. Everything
 * player-facing was promoted to DRAWER_PRIMARY in Tim's 2026-05-22 re-IA.
 */
export const DRAWER_SECONDARY: readonly NavLink[] = [
  { label: "About Tournamental", i18nKey: "nav.about",          href: "https://tournamental.com",              icon: <CodeIcon />, external: true },
  { label: "How it works",       i18nKey: "nav.how_it_works",   href: "https://tournamental.com/how-it-works", icon: <CodeIcon />, external: true },
  { label: "Engineering log",    i18nKey: "nav.engineering_log",href: "https://tournamental.com/engineering",  icon: <CodeIcon />, external: true },
  { label: "Open source",        i18nKey: "nav.open_source",    href: "https://github.com/0800tim/tournamental", icon: <CodeIcon />, external: true },
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
