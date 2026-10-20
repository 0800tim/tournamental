import "./globals.css";
import "@/components/shell/shell.css";
import "@/components/ui/ui.css";

import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import type { ReactNode } from "react";

import { GtmRoot } from "@/components/analytics/GtmRoot";
import { MagicLinkConsumer } from "@/components/auth/MagicLinkConsumer";
import { ProfileCompletionGate } from "@/components/auth/ProfileCompletionGate";
import { NativeShellBoot } from "@/components/NativeShellBoot";
import { LOCALES, type Locale } from "@/i18n/config";
import { ShellModeProvider } from "@/lib/archive/context";
import { ARCHIVE_HEADER, HUB_HEADER } from "@/lib/archive/server";
import { isGdprCountryOrUnknown } from "@/lib/geo/eea";
import { chromeTournament, summarise, tournamentBySlug, upcomingTournament } from "@/lib/tournaments/registry";

// Host modes (2026-10-16): the shell reads request headers to decide
// live / hub / archive. Statically prerendered routes (bot-arena,
// players, opening-ceremonies, ...) would bake the live shell into
// HTML served on the archive host, so every route renders per request.
// Low traffic on archive hosts; the edge still caches static assets.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Anchor every page's relative og:image / canonical URL to the
  // public origin instead of letting Next default to
  // http://localhost:<PORT>. Without this, the share-landing OG image
  // resolves to `http://localhost:3300/api/og/bracket?...` in
  // production, which WhatsApp / X / Telegram crawlers can't fetch,
  // so they fall back to a generic glyph (Tim 2026-05-24).
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_PLAY_ORIGIN ?? "https://play.tournamental.com",
  ),
  title: {
    default: "Tournamental · FWC2026, Predict the matches that matter",
    template: "%s · Tournamental · FWC2026",
  },
  description:
    "Tournamental is a tournament prediction game with a 3D match watch-along, blockchain-verified prediction receipts, and a Telegram bot identity. Open source under Apache 2.0.",
  applicationName: "Tournamental",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Tournamental",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Dark-only canvas (see docs/BRAND.md §2). The play app no longer
  // ships a light shell, so a single themeColor avoids the browser
  // chrome flashing on prefers-color-scheme changes.
  themeColor: "#15151a",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Region-gate the cookie consent prompt. Cloudflare adds CF-IPCountry
  // on every tunnel-routed request; we read it server-side at SSR so
  // non-GDPR visitors never see the banner mount even briefly.
  // Unknown → treat as GDPR (safer to over-prompt than under-prompt).
  const h = await headers();
  const cfCountry = h.get("cf-ipcountry");
  const showConsent = isGdprCountryOrUnknown(cfCountry);

  // Archive mode (2026-10-16): middleware stamps x-tnm-archive on
  // requests to an archived tournament's hostname. The whole tree then
  // renders read-only: no sign-in flows, no CTAs, counts as percentages.
  const archiveSlug = h.get(ARCHIVE_HEADER);
  const archive = archiveSlug ? tournamentBySlug(archiveSlug) : null;
  const hub = h.get(HUB_HEADER) === "1";
  const shellMode = {
    mode: archive ? ("archive" as const) : hub ? ("hub" as const) : ("live" as const),
    slug: archive ? archive.slug : null,
    name: archive ? archive.name : null,
    endsUtc: archive ? archive.endsUtc : null,
    // The entry the chrome is about (2026-10-20): the archived one on an
    // archive host, the active or newest archived one on play, none on
    // the hub, where the upcoming entry carries the labels instead.
    current: archive ? summarise(archive) : hub ? null : summarise(chromeTournament()),
    upcoming: summarise(upcomingTournament()),
  };

  // i18n: locale is resolved by i18n/request.ts from the vt_locale
  // cookie (set by middleware.ts based on CF-IPCountry + Accept-Language
  // on first visit and by the LocalePicker on user select). messages
  // come from apps/web/locales/<code>.json.
  const locale = (await getLocale()) as Locale;
  const messages = await getMessages();
  const meta = LOCALES.find((l) => l.code === locale) ?? LOCALES[0]!;

  return (
    <html lang={locale} dir={meta.rtl ? "rtl" : "ltr"} data-archive={archive ? archive.slug : undefined}>
      <head>
        {/* iOS standalone web-app behaviour. The Next metadata API
            covers most of these but the meta tags are still required by
            iOS Safari for the legacy "add to home screen" path. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Tournamental" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      {/* suppressHydrationWarning: browser extensions (ColorZilla,
        * Grammarly, password managers, dark-mode toggles) inject extra
        * attributes onto <body> before React hydrates. React then logs a
        * loud SSR/CSR-mismatch warning even though nothing is actually
        * broken. The suppress applies only to attributes on <body>
        * itself, not its children, so legitimate hydration mismatches
        * elsewhere still surface. Tim 2026-06-04. */}
      <body suppressHydrationWarning>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ShellModeProvider value={shellMode}>
            <GtmRoot showConsentBanner={showConsent} />
            <NativeShellBoot />
            {archive ? null : (
              <>
                <MagicLinkConsumer />
                <ProfileCompletionGate />
              </>
            )}
            {children}
          </ShellModeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
