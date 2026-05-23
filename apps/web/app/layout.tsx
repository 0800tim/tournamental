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
import { NativeShellBoot } from "@/components/NativeShellBoot";
import { LOCALES, type Locale } from "@/i18n/config";
import { isGdprCountryOrUnknown } from "@/lib/geo/eea";

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
  const h = headers();
  const cfCountry = h.get("cf-ipcountry");
  const showConsent = isGdprCountryOrUnknown(cfCountry);

  // i18n: locale is resolved by i18n/request.ts from the vt_locale
  // cookie (set by middleware.ts based on CF-IPCountry + Accept-Language
  // on first visit and by the LocalePicker on user select). messages
  // come from apps/web/locales/<code>.json.
  const locale = (await getLocale()) as Locale;
  const messages = await getMessages();
  const meta = LOCALES.find((l) => l.code === locale) ?? LOCALES[0]!;

  return (
    <html lang={locale} dir={meta.rtl ? "rtl" : "ltr"}>
      <head>
        {/* iOS standalone web-app behaviour. The Next metadata API
            covers most of these but the meta tags are still required by
            iOS Safari for the legacy "add to home screen" path. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Tournamental" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <GtmRoot showConsentBanner={showConsent} />
          <NativeShellBoot />
          <MagicLinkConsumer />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
