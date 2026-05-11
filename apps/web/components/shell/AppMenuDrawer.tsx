"use client";

/**
 * Full-screen mobile menu drawer.
 *
 * Slides up from the bottom on mobile when the "Menu" tab is tapped on
 * the bottom nav. Holds the same primary + secondary links as the
 * desktop side-rail plus the World Cup 2026 microsite cross-links.
 *
 * Why a full-screen sheet, not a half-modal: a tournament microsite has
 * a deep enough secondary menu (Leaderboard / Syndicates / Open source
 * / Settings + four WC sections + a profile row) that a half-modal
 * crowds the choices. Full-screen reads as a primary destination.
 *
 * Closing: tap the X, tap the backdrop above the drawer, press Escape,
 * or back-navigate. On route change the drawer auto-closes, we
 * subscribe to `popstate` and to the next-router `pushState`.
 */

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import {
  HomeIcon,
  PredictIcon,
  WatchIcon,
  ProfileIcon,
  TrophyIcon,
  GroupsIcon,
  CodeIcon,
  SettingsIcon,
  MoleculeIcon,
  ShareIcon,
} from "./icons";

interface DrawerLink {
  readonly label: string;
  readonly href: string;
  readonly icon: ReactNode;
  readonly external?: boolean;
}

const PRIMARY: readonly DrawerLink[] = [
  { label: "Home",    href: "/",                icon: <HomeIcon /> },
  { label: "Predict", href: "/world-cup-2026",  icon: <PredictIcon /> },
  { label: "Watch",   href: "/watch",           icon: <WatchIcon /> },
  { label: "Profile", href: "/profile",         icon: <ProfileIcon /> },
];

const WC2026: readonly DrawerLink[] = [
  { label: "Bracket Prophet",  href: "/world-cup-2026",                                          icon: <PredictIcon /> },
  { label: "3D Molecule",      href: "/world-cup-2026/molecule",                                 icon: <MoleculeIcon /> },
  { label: "Save & share",     href: "/world-cup-2026#final",                                    icon: <ShareIcon /> },
  { label: "Watch the 2022 final", href: "/match/fifa-wc-2022-final-arg-fra-2022-12-18",         icon: <WatchIcon /> },
];

const SECONDARY: readonly DrawerLink[] = [
  { label: "Leaderboard", href: "/leaderboard", icon: <TrophyIcon /> },
  { label: "Syndicates",  href: "/syndicates",  icon: <GroupsIcon /> },
  { label: "About Tournamental", href: "https://tournamental.com", icon: <CodeIcon />, external: true },
  { label: "Open source", href: "https://github.com/0800tim/tournamental", icon: <CodeIcon />, external: true },
  { label: "Settings",    href: "/settings",    icon: <SettingsIcon /> },
];

export interface AppMenuDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function AppMenuDrawer({ open, onClose }: AppMenuDrawerProps) {
  const handleEsc = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return undefined;
    document.addEventListener("keydown", handleEsc);
    // Lock body scroll while the drawer is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = prev;
    };
  }, [open, handleEsc]);

  if (!open) return null;

  return (
    <div
      className="vt-drawer-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
    >
      <aside
        className="vt-drawer"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="vt-drawer-header">
          <span className="vt-drawer-brand">
            <span className="vt-drawer-brand-mark" aria-hidden="true">T</span>
            Tournamental
          </span>
          <button
            type="button"
            className="vt-drawer-close"
            aria-label="Close menu"
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        <div className="vt-drawer-section-label">App</div>
        <DrawerLinks links={PRIMARY} onClick={onClose} />
        <div className="vt-drawer-section-label">World Cup 2026</div>
        <DrawerLinks links={WC2026} onClick={onClose} />
        <div className="vt-drawer-section-label">More</div>
        <DrawerLinks links={SECONDARY} onClick={onClose} />
      </aside>
    </div>
  );
}

function DrawerLinks({
  links,
  onClick,
}: {
  links: readonly DrawerLink[];
  onClick: () => void;
}) {
  return (
    <ul className="vt-drawer-list">
      {links.map((link) => (
        <li key={link.href}>
          {link.external ? (
            <a
              href={link.href}
              className="vt-drawer-link"
              target="_blank"
              rel="noreferrer"
              onClick={onClick}
            >
              {link.icon}
              <span>{link.label}</span>
            </a>
          ) : (
            <Link
              href={link.href}
              className="vt-drawer-link"
              onClick={onClick}
            >
              {link.icon}
              <span>{link.label}</span>
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Hook that exposes drawer open/close state for use in the bottom nav.
 * Centralises the state so the bottom nav's "Menu" tap can drive it.
 */
import { useState as useStateLocal } from "react";

export function useMobileMenuState() {
  const [open, setOpen] = useStateLocal(false);
  return {
    open,
    openDrawer: () => setOpen(true),
    closeDrawer: () => setOpen(false),
    toggleDrawer: () => setOpen((p) => !p),
  };
}
