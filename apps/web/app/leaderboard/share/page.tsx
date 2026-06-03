/**
 * /leaderboard/share, public landing for a "share my rank" link.
 *
 * Emits OG meta tags that point at /api/og/leaderboard with the rank
 * details forwarded from the share params, so WhatsApp / X / Telegram /
 * iMessage unfurl into a polished rank card. Then renders a thin page
 * that previews the image and CTAs the recipient back to /leaderboard
 * (their own race to catch the sharer) (Tim 2026-05-22, doc 24).
 *
 * Cache: long edge TTL + SWR. The rank info is encoded in query params
 * so the URL itself is content-addressed.
 */

import type { Metadata } from "next";

import { AppShell } from "@/components/shell";

type SearchParams = {
  handle?: string;
  rank?: string;
  points?: string;
  percentile?: string;
  scope?: string;
  tournament?: string;
};

interface Params {
  readonly searchParams: Promise<SearchParams>;
}

function ogUrl(sp: SearchParams, size: "landscape" | "portrait" | "square"): string {
  const u = new URLSearchParams();
  u.set("size", size);
  if (sp.handle) u.set("handle", sp.handle);
  if (sp.rank) u.set("rank", sp.rank);
  if (sp.points) u.set("points", sp.points);
  if (sp.percentile) u.set("percentile", sp.percentile);
  if (sp.scope) u.set("scope", sp.scope);
  if (sp.tournament) u.set("tournament", sp.tournament);
  return `/api/og/leaderboard?${u.toString()}`;
}

export async function generateMetadata(p: Params): Promise<Metadata> {
  const sp = await p.searchParams;
  const handle = sp.handle ?? "Predictor";
  const rank = sp.rank ?? "?";
  const scope = (sp.scope ?? "global").toLowerCase();
  const title = `@${handle} is #${rank} on the ${scope} leaderboard`;
  const description = `Tournamental Football World Cup 2026 prediction game. Catch them.`;
  const landscape = ogUrl(sp, "landscape");
  const square = ogUrl(sp, "square");
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [
        { url: landscape, width: 1200, height: 630, alt: title },
        { url: square, width: 1080, height: 1080, alt: title },
      ],
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [landscape],
    },
  };
}

export default async function LeaderboardSharePage(p: Params) {
  const sp = await p.searchParams;
  const handle = sp.handle ?? "Predictor";
  const rank = sp.rank ?? "?";
  const points = sp.points ? Number(sp.points) : null;
  return (
    <AppShell title="Leaderboard rank">
      <main
        style={{
          padding: 32,
          color: "var(--vt-fg)",
          maxWidth: 760,
          margin: "0 auto",
        }}
      >
        <h1 style={{ fontFamily: "var(--vt-display, serif)", fontSize: 40, margin: "0 0 12px" }}>
          @{handle} is #{rank}
        </h1>
        {points !== null && (
          <p style={{ color: "var(--vt-fg-muted)", margin: "0 0 16px" }}>
            {points.toLocaleString()} points on the Tournamental prediction
            leaderboard.
          </p>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={ogUrl(sp, "landscape")}
          alt={`@${handle} is rank ${rank}`}
          width={1200}
          height={630}
          style={{
            width: "100%",
            height: "auto",
            borderRadius: 12,
            marginTop: 8,
          }}
        />
        <p style={{ marginTop: 24 }}>
          <a
            href="/leaderboard"
            style={{ color: "var(--vt-gold-300, #fcd34d)", textDecoration: "none", fontWeight: 700 }}
          >
            See the full leaderboard &rarr;
          </a>
        </p>
        <p style={{ marginTop: 12 }}>
          <a
            href="/world-cup-2026"
            style={{ color: "var(--vt-fg-muted)", fontSize: 14 }}
          >
            Or build your own bracket and catch them.
          </a>
        </p>
      </main>
    </AppShell>
  );
}
