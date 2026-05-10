import "./globals.css";
import "@/components/shell/shell.css";
import "@/components/ui/ui.css";

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { NativeShellBoot } from "@/components/NativeShellBoot";

export const metadata: Metadata = {
  title: "Tournamental — Predict the matches that matter",
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
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0e1a" },
    { media: "(prefers-color-scheme: light)", color: "#f5f7fc" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
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
        <NativeShellBoot />
        {children}
      </body>
    </html>
  );
}
