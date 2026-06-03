/**
 * /world-cup-2026/share/<bracketId>, public shareable page for one
 * user's bracket. Emits OG meta tags pointing at the per-bracket OG
 * image. Twitter Card + Open Graph + Telegram preview compatible.
 *
 * Cache: this is a read of an immutable, content-addressed bracket id -
 * `public, max-age=300, s-maxage=86400, stale-while-revalidate=604800`.
 */

import type { Metadata } from "next";

import { AppShell } from "@/components/shell";

type SearchParams = {
  handle?: string;
  winner?: string;
  locked?: string;
  /** Optional path / kit / podium overrides forwarded to the canvas renderer. */
  path?: string;
  kit?: string;
  runner_up?: string;
  third?: string;
  tournament?: string;
  pundit?: string;
};

interface Params {
  readonly params: Promise<{ bracketId: string }>;
  readonly searchParams: Promise<SearchParams>;
}

function ogUrl(bracketId: string, sp: SearchParams, size: "landscape" | "portrait" | "square"): string {
  const u = new URLSearchParams();
  u.set("bracket_id", bracketId);
  u.set("size", size);
  if (sp.handle) u.set("handle", sp.handle);
  if (sp.winner) u.set("winner", sp.winner);
  if (sp.locked) u.set("locked", sp.locked);
  if (sp.path) u.set("path", sp.path);
  if (sp.kit) u.set("kit", sp.kit);
  if (sp.runner_up) u.set("runner_up", sp.runner_up);
  if (sp.third) u.set("third", sp.third);
  if (sp.tournament) u.set("tournament", sp.tournament);
  if (sp.pundit) u.set("pundit", sp.pundit);
  return `/api/og/bracket?${u.toString()}`;
}

export async function generateMetadata(p: Params): Promise<Metadata> {
  const sp = await p.searchParams;
  const { bracketId } = await p.params;
  const handle = sp.handle ?? "Anonymous";
  const winner = sp.winner ?? "TBD";
  const ogLandscape = ogUrl(bracketId, sp, "landscape");
  const ogSquare = ogUrl(bracketId, sp, "square");
  return {
    title: `@${handle}'s World Cup 2026 bracket, Tournamental`,
    description: `${handle} picked ${winner} to lift the trophy. Save yours before kickoff.`,
    openGraph: {
      title: `@${handle}'s World Cup 2026 bracket`,
      description: `${handle} picked ${winner} to lift the trophy.`,
      // Landscape first (X / FB / LinkedIn / Telegram pick the first that
      // fits their unfurl); square second so WhatsApp / Slack get a nicer
      // 1:1 thumbnail when they prefer it.
      images: [
        { url: ogLandscape, width: 1200, height: 630, alt: `${handle}'s bracket` },
        { url: ogSquare, width: 1080, height: 1080, alt: `${handle}'s bracket` },
      ],
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: `@${handle}'s World Cup 2026 bracket`,
      description: `${handle} picked ${winner} to lift the trophy.`,
      images: [ogLandscape],
    },
  };
}

export default async function SharePage(p: Params) {
  const sp = await p.searchParams;
  const { bracketId } = await p.params;
  const handle = sp.handle ?? "Anonymous";
  const winner = sp.winner ?? "TBD";
  return (
    <AppShell title="Shared bracket">
      <main style={{ padding: 32, color: "var(--vt-fg)", maxWidth: 720, margin: "0 auto" }}>
        <h1>@{handle}&apos;s World Cup 2026 bracket</h1>
        <p>Picked <strong>{winner}</strong> to lift the trophy.</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={ogUrl(bracketId, sp, "landscape")}
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
