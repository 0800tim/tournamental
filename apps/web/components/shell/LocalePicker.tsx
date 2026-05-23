"use client";

/**
 * LocalePicker — language dropdown for play.tournamental.com.
 *
 * Sits in the AppBar (desktop) and the burger drawer (mobile). On
 * select, writes the `vt_locale` cookie (Domain=.tournamental.com,
 * 1y, SameSite=Lax) and reloads with the new locale prefix in the
 * URL so the next-intl middleware picks it up. SSR-safe; falls back
 * to "en" when window is undefined.
 *
 * The full /languages page renders the same catalogue as a grid
 * with large flag tiles; this component is the always-accessible
 * inline switcher.
 *
 * See docs/60-i18n-architecture.md for the full design.
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import {
  DEFAULT_LOCALE,
  LOCALES,
  type Locale,
  type LocaleMeta,
} from "@/i18n/config";

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

const COOKIE_NAME = "vt_locale";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

function readCookieLocale(): Locale | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!raw) return null;
  const value = raw.slice(COOKIE_NAME.length + 1);
  return (LOCALES.find((l) => l.code === value)?.code ?? null);
}

function writeCookieLocale(code: Locale): void {
  if (typeof document === "undefined") return;
  // Use the parent domain so the cookie is shared across
  // play.tournamental.com, tournamental.com, auth.tournamental.com.
  document.cookie = [
    `${COOKIE_NAME}=${code}`,
    "Path=/",
    "Domain=.tournamental.com",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "Secure"
      : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** Strip the locale prefix from a pathname (e.g. /fr/world-cup-2026
 * → /world-cup-2026). Returns the path unchanged if it doesn't start
 * with a known locale prefix. */
function stripLocalePrefix(path: string): string {
  const first = path.split("/")[1] ?? "";
  if (LOCALES.some((l) => l.code === first)) {
    return path.slice(first.length + 1) || "/";
  }
  return path;
}

export interface LocalePickerProps {
  /** Variant for placement: inline pill in the AppBar vs full row in
   * the burger drawer. Drives sizing + label visibility only. */
  readonly variant?: "appbar" | "drawer";
}

export function LocalePicker({ variant = "appbar" }: LocalePickerProps): JSX.Element {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<Locale>(DEFAULT_LOCALE);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fromCookie = readCookieLocale();
    if (fromCookie) {
      setCurrent(fromCookie);
      return;
    }
    // Try to infer from the URL prefix on first paint (covers
    // direct-link visits like play.tournamental.com/fr/...).
    if (typeof window !== "undefined") {
      const first = window.location.pathname.split("/")[1] ?? "";
      const fromUrl = LOCALES.find((l) => l.code === first);
      if (fromUrl) setCurrent(fromUrl.code);
    }
  }, []);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const select = (code: Locale): void => {
    writeCookieLocale(code);
    setCurrent(code);
    setOpen(false);
    if (typeof window === "undefined") return;
    // Wipe any client-side caches keyed to the previous locale (the
    // SHELL_CACHE / RUNTIME_CACHE were the cause of "I picked a language
    // and nothing changed" on prod), then redirect to the locale-prefixed
    // URL so:
    //   - the URL bar reflects the active language (`/es/world-cup-2026`)
    //     and is shareable,
    //   - middleware rewrites the request server-side, stamps the cookie,
    //     and renders the right catalogue.
    // English (DEFAULT_LOCALE) doesn't prefix; we just drop the prefix so
    // bookmarks stay clean.
    Promise.resolve()
      .then(async () => {
        try {
          if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
          }
        } catch {
          /* best-effort */
        }
      })
      .finally(() => {
        const u = new URL(window.location.href);
        u.searchParams.delete("_l");
        const stripped = stripLocalePrefix(u.pathname);
        const newPath =
          code === DEFAULT_LOCALE ? stripped : `/${code}${stripped === "/" ? "" : stripped}`;
        u.pathname = newPath;
        window.location.assign(u.toString());
      });
  };

  const currentMeta: LocaleMeta =
    LOCALES.find((l) => l.code === current) ?? LOCALES[0]!;

  // Group locales by region for the menu.
  const groups: Array<{ id: LocaleMeta["region"]; label: string; items: LocaleMeta[] }> = [
    { id: "americas",           label: safeT(t, "locale_picker.region.americas", "Americas"),                items: [] },
    { id: "europe",             label: safeT(t, "locale_picker.region.europe", "Europe"),                    items: [] },
    { id: "asia-pacific",       label: safeT(t, "locale_picker.region.asia-pacific", "Asia-Pacific"),        items: [] },
    { id: "middle-east-africa", label: safeT(t, "locale_picker.region.middle-east-africa", "Middle East & Africa"), items: [] },
  ];
  for (const meta of LOCALES) {
    const g = groups.find((g) => g.id === meta.region);
    if (g) g.items.push(meta);
  }

  return (
    <div
      className={`vt-locale-picker vt-locale-picker--${variant}`}
      data-open={open ? "1" : undefined}
    >
      <button
        ref={buttonRef}
        type="button"
        className="vt-locale-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={safeT(t, "locale_picker.aria_open", "Choose your language")}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="vt-locale-picker-flag" aria-hidden="true">
          {currentMeta.flag}
        </span>
        <span className="vt-locale-picker-code">{currentMeta.code.toUpperCase()}</span>
        {variant === "drawer" && (
          <span className="vt-locale-picker-native">{currentMeta.native}</span>
        )}
        <span className="vt-locale-picker-chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div
          ref={menuRef}
          className="vt-locale-picker-menu"
          role="listbox"
          aria-label="Language selection"
        >
          {groups.map((g) =>
            g.items.length === 0 ? null : (
              <section key={g.id} className="vt-locale-picker-group">
                <p className="vt-locale-picker-group-label">{g.label}</p>
                <ul>
                  {g.items.map((m) => (
                    <li key={m.code}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={m.code === current}
                        className="vt-locale-picker-option"
                        data-selected={m.code === current ? "1" : undefined}
                        onClick={() => select(m.code)}
                      >
                        <span className="vt-locale-picker-flag" aria-hidden="true">
                          {m.flag}
                        </span>
                        <span className="vt-locale-picker-native-name">{m.native}</span>
                        <span className="vt-locale-picker-english-name">
                          {m.english}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ),
          )}
          <p className="vt-locale-picker-footer">
            <a href="/languages">{safeT(t, "common.see_all_languages", "See all languages →")}</a>
          </p>
        </div>
      )}
    </div>
  );
}
