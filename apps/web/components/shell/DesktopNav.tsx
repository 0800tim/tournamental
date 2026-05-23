"use client";

/**
 * Desktop horizontal nav row.
 *
 * Sits as a second row inside the AppBar on viewports >= 768px and is
 * `display: none` on phones (mobile keeps the burger + drawer as the
 * full nav surface). The row holds:
 *
 *   - Inline PRIMARY links from ./nav-links — the items Tim's users hit
 *     most of the time. Active-route pill gets a gold underline + bold
 *     weight via data-active="1".
 *   - A "More" dropdown button that opens a menu of the secondary links
 *     (MORE_DESKTOP). The dropdown closes on outside-click, on Escape,
 *     and when any item is selected.
 *   - A right-aligned AuthChip — "Sign in" pill for guests, avatar +
 *     handle pill for authenticated users.
 *
 * Why a sibling component to AppBar rather than living inside it: the
 * AppBar is RSC-friendly other than its hamburger button, but the
 * desktop nav needs `usePathname` and `useUser` and a click-away
 * listener. Extracting it keeps the AppBar lean and lets us code-split
 * the heavier client-only logic into a single chunk.
 *
 * Accessibility:
 *   - <nav aria-label="Primary"> wraps the whole row.
 *   - The More button uses aria-haspopup="menu" + aria-expanded; its
 *     panel is role="menu" with role="menuitem" children. Arrow keys
 *     traverse the panel; Escape closes it and returns focus to the
 *     button.
 *
 * Performance:
 *   - All link routes are static; we render them once. Active-route
 *     state lives on a data-attribute so a route change is one DOM diff,
 *     not a re-render per link.
 *   - The AuthChip is the only piece that reads useUser(); the rest of
 *     the row is independent of auth state.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AuthChip } from "./AuthChip";
import {
  PRIMARY_DESKTOP,
  MORE_DESKTOP,
  isLinkActive,
  pickActiveLink,
  type NavLink,
} from "./nav-links";

export function DesktopNav() {
  const pathname = usePathname() ?? "/";
  // Pick the single most-specific active link from PRIMARY_DESKTOP so
  // /world-cup-2026/molecule highlights "3D Molecule" only, not Predict
  // as well. See pickActiveLink for the longest-prefix rule.
  const activeInline = pickActiveLink(PRIMARY_DESKTOP, pathname);
  const activeMore = pickActiveLink(MORE_DESKTOP, pathname);

  return (
    <nav className="vt-appbar-nav" aria-label="Primary">
      <ul className="vt-appbar-nav-list" role="list">
        {PRIMARY_DESKTOP.map((link) => (
          <li key={link.href}>
            <NavPill link={link} active={activeInline?.href === link.href} />
          </li>
        ))}
        <li>
          <MoreDropdown
            links={MORE_DESKTOP}
            activeHref={activeMore?.href ?? null}
          />
        </li>
      </ul>
      <div className="vt-appbar-nav-spacer" aria-hidden="true" />
      <AuthChip />
    </nav>
  );
}

function NavPill({ link, active }: { link: NavLink; active: boolean }) {
  const t = useTranslations();
  const label = safeT(t, link.i18nKey, link.label);
  const className = "vt-appbar-nav-link";
  const dataActive = active ? "1" : "0";
  if (link.external) {
    return (
      <a
        href={link.href}
        className={className}
        data-active={dataActive}
        target="_blank"
        rel="noreferrer"
        aria-current={active ? "page" : undefined}
      >
        {label}
      </a>
    );
  }
  return (
    <Link
      href={link.href}
      className={className}
      data-active={dataActive}
      aria-current={active ? "page" : undefined}
    >
      {label}
    </Link>
  );
}

/**
 * Translation lookup that swallows MISSING_MESSAGE errors and falls
 * back to the supplied English string. Lets us roll out i18n
 * incrementally without throwing when a locale file is missing a key
 * we just added on `main`.
 */
function safeT(
  t: ReturnType<typeof useTranslations>,
  key: string,
  fallback: string,
): string {
  try {
    const out = t(key);
    // next-intl returns the key itself when not found; treat that as a miss.
    if (out === key) return fallback;
    return out;
  } catch {
    return fallback;
  }
}

function MoreDropdown({
  links,
  activeHref,
}: {
  links: readonly NavLink[];
  activeHref: string | null;
}) {
  const t = useTranslations();
  const moreLabel = safeT(t, "nav.more", "More");
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Outside-click + Escape close.
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        panelRef.current?.contains(t) ||
        buttonRef.current?.contains(t)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Keyboard arrow traversal within the menu.
  const onPanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = panelRef.current?.querySelectorAll<HTMLAnchorElement>(
      '[role="menuitem"]',
    );
    if (!items || items.length === 0) return;
    const idx = Array.from(items).indexOf(
      document.activeElement as HTMLAnchorElement,
    );
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = items[(idx + 1) % items.length];
      next?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = items[(idx - 1 + items.length) % items.length];
      prev?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  const moreIsActive = activeHref !== null;

  return (
    <div className="vt-appbar-more">
      <button
        ref={buttonRef}
        type="button"
        className="vt-appbar-nav-link vt-appbar-more-button"
        data-active={moreIsActive ? "1" : "0"}
        aria-haspopup="menu"
        aria-expanded={open ? "true" : "false"}
        onClick={() => setOpen((o) => !o)}
      >
        {moreLabel}
        <Caret open={open} />
      </button>
      {open ? (
        <div
          ref={panelRef}
          className="vt-appbar-more-panel"
          role="menu"
          aria-label="More navigation"
          onKeyDown={onPanelKeyDown}
        >
          <ul className="vt-appbar-more-list" role="none">
            {links.map((link) => (
              <li key={link.href} role="none">
                <MoreItem
                  link={link}
                  active={activeHref === link.href}
                  onSelect={close}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function MoreItem({
  link,
  active,
  onSelect,
}: {
  link: NavLink;
  active: boolean;
  onSelect: () => void;
}): ReactNode {
  const t = useTranslations();
  const label = safeT(t, link.i18nKey, link.label);
  const cls = "vt-appbar-more-item";
  const dataActive = active ? "1" : "0";
  if (link.external) {
    return (
      <a
        href={link.href}
        className={cls}
        data-active={dataActive}
        role="menuitem"
        target="_blank"
        rel="noreferrer"
        onClick={onSelect}
      >
        <span className="vt-appbar-more-icon" aria-hidden="true">
          {link.icon}
        </span>
        <span>{label}</span>
        <span className="vt-appbar-more-external" aria-hidden="true">
          ↗
        </span>
      </a>
    );
  }
  return (
    <Link
      href={link.href}
      className={cls}
      data-active={dataActive}
      role="menuitem"
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
    >
      <span className="vt-appbar-more-icon" aria-hidden="true">
        {link.icon}
      </span>
      <span>{link.label}</span>
    </Link>
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      className="vt-appbar-more-caret"
      data-open={open ? "1" : "0"}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// Re-export the helpers for tests / external consumers.
export { isLinkActive, pickActiveLink };
