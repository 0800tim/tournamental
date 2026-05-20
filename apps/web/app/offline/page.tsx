/**
 * /offline — service-worker fallback page.
 *
 * Served from sw.js when the network is unreachable and the requested
 * navigation is not in the shell cache. Deliberately tiny: a single
 * Fraunces "Offline" headline, the gold-ball mark, and a try-again hint.
 *
 * No client JS, no fetches. The page must work with the cache and
 * nothing else.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline",
  description: "You are offline. Try again when you are back online.",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "32px",
        background: "#15151a",
        color: "#e6e6ea",
        fontFamily:
          "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <img
          src="/icons/icon-192.png"
          alt=""
          width={96}
          height={96}
          decoding="async"
          style={{ display: "block", margin: "0 auto 24px" }}
        />
        <h1
          style={{
            fontFamily:
              "Fraunces, ui-serif, Charter, Georgia, Cambria, 'Times New Roman', Times, serif",
            fontWeight: 500,
            fontSize: "clamp(40px, 8vw, 64px)",
            letterSpacing: "-0.012em",
            margin: "0 0 12px",
            color: "#ffffff",
          }}
        >
          Offline
        </h1>
        <p
          style={{
            margin: 0,
            color: "#a3a3ad",
            fontSize: "16px",
            lineHeight: 1.5,
          }}
        >
          Try again when you are back online.
        </p>
      </div>
    </main>
  );
}
