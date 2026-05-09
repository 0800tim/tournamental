import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VTourn Admin",
  description: "Internal operations console — VTourn",
  robots: { index: false, follow: false },
};

/**
 * Root layout is intentionally minimal — no cookie / header reads here.
 * The sidebar lives in `(authed)/layout.tsx` so that statically-
 * generated pages like /_not-found and /_error don't pull the auth-
 * aware tree.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-ink-900 text-ink-100">{children}</body>
    </html>
  );
}
