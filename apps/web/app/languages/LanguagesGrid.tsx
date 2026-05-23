"use client";

/**
 * The clickable language grid for /languages.
 *
 * Each tile is a large flag emoji + native language name + English
 * name. Tapping a tile writes the vt_locale cookie and reloads at
 * the locale-prefixed URL. The grid is the visual counterpart to the
 * compact LocalePicker dropdown that sits in the AppBar.
 */

import { useState } from "react";

import {
  DEFAULT_LOCALE,
  LOCALES,
  type Locale,
} from "@/i18n/config";

const COOKIE_NAME = "vt_locale";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function writeCookieLocale(code: Locale): void {
  if (typeof document === "undefined") return;
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

function stripLocalePrefix(path: string): string {
  const first = path.split("/")[1] ?? "";
  if (LOCALES.some((l) => l.code === first)) {
    return path.slice(first.length + 1) || "/";
  }
  return path;
}

export function LanguagesGrid(): JSX.Element {
  const [busy, setBusy] = useState<Locale | null>(null);

  const select = (code: Locale): void => {
    setBusy(code);
    writeCookieLocale(code);
    if (typeof window === "undefined") return;
    // Cache wipe + redirect to the locale-prefixed home so the URL
    // bar reflects the active language and is shareable. English
    // (DEFAULT_LOCALE) drops the prefix to keep bookmarks clean.
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
        const target = code === DEFAULT_LOCALE ? "/" : `/${code}`;
        window.location.assign(target);
      });
  };

  return (
    <section
      className="vt-languages-grid-wrap"
      aria-label="Supported languages"
    >
      <ul className="vt-languages-grid" role="list">
        {LOCALES.map((m) => (
          <li key={m.code}>
            <button
              type="button"
              className="vt-languages-tile"
              onClick={() => select(m.code)}
              disabled={busy === m.code}
              aria-label={`Set language to ${m.english} (${m.native})`}
              data-rtl={m.rtl ? "1" : undefined}
              lang={m.code}
            >
              <span className="vt-languages-tile-flag" aria-hidden="true">
                {m.flag}
              </span>
              <span className="vt-languages-tile-native">{m.native}</span>
              <span className="vt-languages-tile-english">{m.english}</span>
              {busy === m.code && (
                <span className="vt-languages-tile-busy" aria-live="polite">
                  Switching…
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
