import "./globals.css";
import "@/components/shell/shell.css";
import "@/components/ui/ui.css";

import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { GtmRoot } from "@/components/analytics/GtmRoot";
import { MagicLinkConsumer } from "@/components/auth/MagicLinkConsumer";
import { NativeShellBoot } from "@/components/NativeShellBoot";
import { isGdprCountryOrUnknown } from "@/lib/geo/eea";

export const metadata: Metadata = {
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

export default function RootLayout({ children }: { children: ReactNode }) {
  // Region-gate the cookie consent prompt. Cloudflare adds CF-IPCountry
  // on every tunnel-routed request; we read it server-side at SSR so
  // non-GDPR visitors never see the banner mount even briefly.
  // Unknown → treat as GDPR (safer to over-prompt than under-prompt).
  const h = headers();
  const cfCountry = h.get("cf-ipcountry");
  const showConsent = isGdprCountryOrUnknown(cfCountry);

  return (
    <html lang="en">
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
        <GtmRoot showConsentBanner={showConsent} />
        <NativeShellBoot />
        <MagicLinkConsumer />
        {children}
      </body>
    </html>
  );
}
