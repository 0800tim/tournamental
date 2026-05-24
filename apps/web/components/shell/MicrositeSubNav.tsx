"use client";

/**
 * Microsite sub-nav strip for the World Cup 2026 campaign.
 *
 * Mounted via `AppShell`'s `subHeader` slot on every `/world-cup-2026/*`
 * page so the user can hop between Predict (bracket), Molecule (3D map),
 * Save & share, and the Watch-along demo without falling back to the
 * top-level platform nav.
 *
 * Visual: horizontal sticky pill strip, each pill a flag-icon + label.
 * Active pill picks up the gold accent (`--vt-accent-warm`). Scrolls
 * sideways on overflow on narrow viewports (no horizontal scroll bars
 *, uses momentum scrolling on touch).
 */

import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";

import { PredictIcon, ShareIcon } from "./icons";

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

export interface MicrositeSubNavLink {
  readonly label: string;
  readonly i18nKey?: string;
  readonly href: string;
  readonly icon: ReactNode;
  readonly matchPrefix?: string;
  /** Exact-match suffix. Useful for distinguishing /world-cup-2026 (bracket) from /world-cup-2026/molecule. */
  readonly exact?: boolean;
}

export const WC2026_SUBNAV: readonly MicrositeSubNavLink[] = [
  // 2026-05-21: play app is bracket-only for the WC 2026 push.
  // Molecule + Watch-along were removed from the subnav (still mounted
  // for the marketing site / lab usage, just not promoted to players).
  {
    label: "Predict",
    i18nKey: "nav.predict",
    href: "/world-cup-2026",
    icon: <PredictIcon />,
    exact: true,
  },
  {
    label: "Save & share",
    i18nKey: "nav.save_share",
    href: "/world-cup-2026/save-share",
    icon: <ShareIcon />,
    matchPrefix: "/world-cup-2026/save-share",
  },
];

export interface MicrositeSubNavProps {
  readonly links?: readonly MicrositeSubNavLink[];
  readonly eyebrow?: string;
}

export function MicrositeSubNav({
  links = WC2026_SUBNAV,
  eyebrow = "WC 2026",
}: MicrositeSubNavProps) {
  const t = useTranslations();
  const [pathname, setPathname] = useState<string>("/");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setPathname(window.location.pathname || "/");
    const onPop = () => setPathname(window.location.pathname || "/");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <nav className="vt-microsite-subnav" aria-label="World Cup 2026 sections">
      <span className="vt-microsite-subnav-eyebrow" aria-hidden="true">{eyebrow}</span>
      <div className="vt-microsite-subnav-pills" role="list">
        {links.map((link) => {
          const isActive = link.matchPrefix
            ? pathname.startsWith(link.matchPrefix)
            : link.exact
              ? pathname === link.href.split("#")[0]
              : pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="vt-microsite-subnav-pill"
              aria-current={isActive ? "page" : undefined}
              role="listitem"
            >
              <span className="vt-microsite-subnav-icon">{link.icon}</span>
              <span>{link.i18nKey ? safeT(t, link.i18nKey, link.label) : link.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
