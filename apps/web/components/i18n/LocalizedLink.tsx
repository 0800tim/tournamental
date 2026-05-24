"use client";

/**
 * Drop-in replacement for next/link's <Link> that prefixes the active
 * locale onto internal `href`s so URL routing survives client-side
 * navigation. Without this, clicking a bare <Link href="/syndicates">
 * from /es/world-cup-2026 lands on /syndicates (locale prefix lost),
 * even though the vt_locale cookie keeps the UI in Spanish.
 *
 * Behaviour:
 *   - href starts with "/" + supported locale → unchanged (caller knows
 *     best, e.g. the locale picker writes its own prefix).
 *   - href starts with another protocol or "//" → external, untouched.
 *   - href starts with "/" → "/<locale><href>" when locale !== "en"
 *     (English is the unprefixed default).
 *   - href starts with "#" or "?" → untouched (in-page anchor / query).
 *
 * Locale source: useLocale() from next-intl. Set by the provider in
 * apps/web/app/layout.tsx, resolved from the vt_locale cookie or
 * url-prefix middleware rewrite.
 *
 * Tim 2026-05-24.
 */

import NextLink, { type LinkProps as NextLinkProps } from "next/link";
import { useLocale } from "next-intl";
import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";

import {
  DEFAULT_LOCALE,
  LOCALE_CODES,
  isSupportedLocale,
  type Locale,
} from "@/i18n/config";

type LocalizedLinkProps = Omit<NextLinkProps, "href"> &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    href: string;
    children?: ReactNode;
  };

/**
 * Re-export of the locale-prefixing function for callers that need to
 * compute an href without rendering an anchor (e.g. router.push()).
 */
export function localizedHref(href: string, locale: Locale): string {
  if (!href) return href;
  if (locale === DEFAULT_LOCALE) return stripPrefixIfPresent(href);
  // External / protocol-relative / mailto / tel / anchor / query-only
  if (
    href.startsWith("//") ||
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:") ||
    href.startsWith("#") ||
    href.startsWith("?")
  ) {
    return href;
  }
  if (!href.startsWith("/")) return href;
  // Already prefixed with a (different) supported locale → swap it.
  const firstSeg = href.split("/")[1] ?? "";
  if (isSupportedLocale(firstSeg)) {
    if (firstSeg === locale) return href;
    const rest = href.slice(firstSeg.length + 1) || "/";
    return locale === DEFAULT_LOCALE
      ? rest
      : `/${locale}${rest === "/" ? "" : rest}`;
  }
  // Bare /path → /<locale>/path
  return href === "/" ? `/${locale}` : `/${locale}${href}`;
}

function stripPrefixIfPresent(href: string): string {
  if (!href.startsWith("/")) return href;
  const firstSeg = href.split("/")[1] ?? "";
  if (isSupportedLocale(firstSeg)) {
    return href.slice(firstSeg.length + 1) || "/";
  }
  return href;
}

export const LocalizedLink = forwardRef<HTMLAnchorElement, LocalizedLinkProps>(
  function LocalizedLink({ href, children, ...rest }, ref) {
    const locale = useLocale() as Locale;
    const finalHref = localizedHref(href, locale);
    return (
      <NextLink href={finalHref} ref={ref} {...rest}>
        {children}
      </NextLink>
    );
  },
);

// Eslint plugin re-exports — LOCALE_CODES is used by callers that
// build an href list (e.g. sitemap generators) and want the same
// stripping behaviour.
export { LOCALE_CODES };
