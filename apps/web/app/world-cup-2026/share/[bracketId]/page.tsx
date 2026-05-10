/**
 * /world-cup-2026/share/<bracketId> — public shareable page for one
 * user's bracket. Emits OG meta tags pointing at the new per-bracket
 * share-PNG endpoint (`/v1/share/bracket/<id>/og.png`). Twitter Card,
 * Open Graph, and Telegram preview compatible.
 *
 * The PNG renderer behind the OG image is the canvas pipeline in
 * `@vtorn/social-cards` — flag-driven, kit-coloured, champion-centric.
 * The same endpoint family also serves `.png` (square / portrait /
 * landscape) and `.mp4` (Instagram / TikTok / Twitter) variants so the
 * user can grab whichever asset matches the network they're posting
 * to.
 *
 * Cache: this is a read of an immutable, content-addressed bracket id —
 * `public, max-age=300, s-maxage=86400, stale-while-revalidate=604800`.
 */

import type { Metadata } from "next";

import { AppShell } from "@/components/shell";

interface Params {
  readonly params: { bracketId: string };
  readonly searchParams: {
    handle?: string;
    winner?: string;
    /** Saved-pick count. (Was `locked` pre-rename — accepted as alias.) */
    saved?: string;
    locked?: string;
    /** Knockout path: r16:AUS,qf:ESP,sf:BRA,final:FRA */
    path?: string;
    /** Optional kit-primary hex override for the radial glow. */
    kit?: string;
  };
}

function buildShareParams(p: Params): URLSearchParams {
  const u = new URLSearchParams();
  if (p.searchParams.handle) u.set("handle", p.searchParams.handle);
  if (p.searchParams.winner) u.set("winner", p.searchParams.winner);
  if (p.searchParams.path) u.set("path", p.searchParams.path);
  if (p.searchParams.kit) u.set("kit", p.searchParams.kit);
  // `locked` is accepted for backwards-compat with already-posted URLs;
  // forward it on so the unfurl image still mentions the saved count.
  const savedCount = p.searchParams.saved ?? p.searchParams.locked;
  if (savedCount) u.set("saved", savedCount);
  return u;
}

function ogImageUrl(p: Params): string {
  const u = buildShareParams(p);
  const qs = u.toString();
  return `/v1/share/bracket/${encodeURIComponent(p.params.bracketId)}/og.png${qs ? `?${qs}` : ""}`;
}

function portraitImageUrl(p: Params): string {
  const u = buildShareParams(p);
  u.set("size", "portrait");
  return `/v1/share/bracket/${encodeURIComponent(p.params.bracketId)}.png?${u.toString()}`;
}

function squareImageUrl(p: Params): string {
  const u = buildShareParams(p);
  u.set("size", "square");
  return `/v1/share/bracket/${encodeURIComponent(p.params.bracketId)}.png?${u.toString()}`;
}

function instagramMp4Url(p: Params): string {
  const u = buildShareParams(p);
  u.set("format", "instagram");
  return `/v1/share/bracket/${encodeURIComponent(p.params.bracketId)}.mp4?${u.toString()}`;
}

function tiktokMp4Url(p: Params): string {
  const u = buildShareParams(p);
  u.set("format", "tiktok");
  return `/v1/share/bracket/${encodeURIComponent(p.params.bracketId)}.mp4?${u.toString()}`;
}

export function generateMetadata(p: Params): Metadata {
  const handle = p.searchParams.handle ?? "Anonymous";
  const winner = p.searchParams.winner ?? "TBD";
  const og = ogImageUrl(p);
  return {
    title: `@${handle}'s World Cup 2026 bracket — VTourn`,
    description: `${handle} picked ${winner} to lift the trophy. Save yours before kickoff.`,
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
  const portrait = portraitImageUrl(p);
  const square = squareImageUrl(p);
  const instagram = instagramMp4Url(p);
  const tiktok = tiktokMp4Url(p);
  return (
    <AppShell title="Shared bracket">
      <main style={{ padding: 32, color: "var(--vt-fg)", maxWidth: 720, margin: "0 auto" }}>
        <h1>@{handle}&apos;s World Cup 2026 bracket</h1>
        <p>Picked <strong>{winner}</strong> to lift the trophy.</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={portrait}
          alt={`@${handle}'s bracket`}
          width={1080}
          height={1350}
          style={{ width: "100%", height: "auto", maxWidth: 540, borderRadius: 12, marginTop: 16 }}
        />
        <p style={{ marginTop: 24, fontSize: 14, color: "var(--vt-fg-muted, #94a3b8)" }}>
          Share-ready assets:&nbsp;
          <a href={portrait} style={{ color: "var(--vt-accent, #facc15)" }}>Portrait PNG</a>
          {" · "}
          <a href={square} style={{ color: "var(--vt-accent, #facc15)" }}>Square PNG</a>
          {" · "}
          <a href={instagram} style={{ color: "var(--vt-accent, #facc15)" }}>Instagram MP4</a>
          {" · "}
          <a href={tiktok} style={{ color: "var(--vt-accent, #facc15)" }}>TikTok MP4</a>
        </p>
        <p style={{ marginTop: 24 }}>
          <a href="/world-cup-2026" style={{ color: "var(--vt-accent, #facc15)" }}>
            Build your own bracket &rarr;
          </a>
        </p>
      </main>
    </AppShell>
  );
}
