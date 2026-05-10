/**
 * /world-cup-2026/share/<bracketId> — public shareable page for one
 * user's bracket. Emits OG meta tags pointing at the per-bracket OG
 * image. Twitter Card + Open Graph + Telegram preview compatible.
 *
 * Cache: this is a read of an immutable, content-addressed bracket id —
 * `public, max-age=300, s-maxage=86400, stale-while-revalidate=604800`.
 */

import type { Metadata } from "next";

import { AppShell } from "@/components/shell";

interface Params {
  readonly params: { bracketId: string };
  readonly searchParams: { handle?: string; winner?: string; locked?: string };
}

function ogUrl(p: Params): string {
  const u = new URLSearchParams();
  u.set("bracket_id", p.params.bracketId);
  if (p.searchParams.handle) u.set("handle", p.searchParams.handle);
  if (p.searchParams.winner) u.set("winner", p.searchParams.winner);
  if (p.searchParams.locked) u.set("locked", p.searchParams.locked);
  return `/api/og/bracket?${u.toString()}`;
}

export function generateMetadata(p: Params): Metadata {
  const handle = p.searchParams.handle ?? "Anonymous";
  const winner = p.searchParams.winner ?? "TBD";
  const og = ogUrl(p);
  return {
    title: `@${handle}'s World Cup 2026 bracket — Tournamental`,
    description: `${handle} picked ${winner} to lift the trophy. Lock yours before kickoff.`,
    openGraph: {
      title: `@${handle}'s World Cup 2026 bracket`,
      description: `${handle} picked ${winner} to lift the trophy.`,
      images: [{ url: og, width: 1200, height: 630, alt: `${handle}'s bracket` }],
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: `@${handle}'s World Cup 2026 bracket`,
      description: `${handle} picked ${winner} to lift the trophy.`,
      images: [og],
    },
  };
}

export default function SharePage(p: Params) {
  const handle = p.searchParams.handle ?? "Anonymous";
  const winner = p.searchParams.winner ?? "TBD";
  return (
    <AppShell title="Shared bracket">
      <main style={{ padding: 32, color: "var(--vt-fg)", maxWidth: 720, margin: "0 auto" }}>
        <h1>@{handle}&apos;s World Cup 2026 bracket</h1>
        <p>Picked <strong>{winner}</strong> to lift the trophy.</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={ogUrl(p)}
          alt={`@${handle}'s bracket`}
          width={1200}
          height={630}
          style={{ width: "100%", height: "auto", borderRadius: 12, marginTop: 16 }}
        />
        <p style={{ marginTop: 24 }}>
          <a href="/world-cup-2026" style={{ color: "var(--vt-accent, #facc15)" }}>
            Build your own bracket &rarr;
          </a>
        </p>
      </main>
    </AppShell>
  );
}
