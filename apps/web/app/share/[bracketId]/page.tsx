/**
 * /share/[bracketId] — canonical public share-target page.
 *
 * Server-rendered Next page that:
 *  - Serves a large OG image hero (cacheable, optimised by the CDN).
 *  - Shows the user's predicted Final pick + winner big and bold, plus
 *    a few of their R16/QF/SF picks below.
 *  - Emits full OG + Twitter Card meta tags so Facebook, X, Slack,
 *    Discord, LinkedIn, iMessage and WhatsApp all unfurl with the rich
 *    bracket-pick card.
 *  - Renders a "Make your prediction" CTA back to /world-cup-2026.
 *
 * Tournament-agnostic: a future Euros or AFCON share lives at the same
 * canonical path (`/share/<bracketId>`) so we never break OG URLs in
 * the wild.
 *
 * Cache: per-bracket-id content is content-addressed and
 * effectively-immutable once locked — long edge cache + SWR.
 */

import type { Metadata } from "next";

import { AppShell } from "@/components/shell";
import {
  buildShareDescription,
  buildShareTitle,
  decodeBracketPayload,
  type BracketSharePayload,
} from "@/lib/share/payload";

interface PageProps {
  readonly params: { bracketId: string };
  readonly searchParams: Record<string, string | string[] | undefined>;
}

export const dynamic = "force-dynamic";

function normaliseSearchParams(
  raw: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

function searchParamsToQuery(
  raw: Record<string, string | string[] | undefined>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    sp.set(k, Array.isArray(v) ? (v[0] ?? "") : v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function generateMetadata({
  params,
  searchParams,
}: PageProps): Metadata {
  const payload = decodeBracketPayload(
    params.bracketId,
    normaliseSearchParams(searchParams),
  );
  const title = buildShareTitle(payload);
  const description = buildShareDescription(payload);
  const ogPath = `/api/og/${encodeURIComponent(params.bracketId)}${searchParamsToQuery(searchParams)}`;
  const canonicalPath = `/share/${encodeURIComponent(params.bracketId)}${searchParamsToQuery(searchParams)}`;

  return {
    title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title,
      description,
      url: canonicalPath,
      type: "article",
      images: [{ url: ogPath, width: 1200, height: 630, alt: title }],
      siteName: "VTourn",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogPath],
    },
    other: {
      // Telegram + iMessage + WhatsApp respect og:image_secure_url too.
      "og:image:secure_url": ogPath,
      "og:image:width": "1200",
      "og:image:height": "630",
    },
  };
}

function StageRow({ payload }: { payload: BracketSharePayload }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 8,
        marginTop: 16,
      }}
    >
      {payload.route.slice(0, 4).map((step) => {
        const isFinal = step.stage === "FINAL";
        return (
          <div
            key={step.stage}
            style={{
              background: isFinal ? "#e76b15" : "#101626",
              border: isFinal ? "2px solid #ffb37a" : "1px solid #1a2238",
              borderRadius: 12,
              padding: "10px 8px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                color: isFinal ? "#fff" : "#94a3b8",
                fontWeight: 700,
              }}
            >
              {step.stage}
            </div>
            <div
              style={{
                fontSize: isFinal ? 22 : 18,
                fontWeight: 900,
                marginTop: 4,
                color: "#fff",
              }}
            >
              {step.teamCode}
            </div>
            {step.flagEmoji ? (
              <div style={{ marginTop: 4, fontSize: 22 }}>{step.flagEmoji}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function SharePage({ params, searchParams }: PageProps) {
  const payload = decodeBracketPayload(
    params.bracketId,
    normaliseSearchParams(searchParams),
  );
  const title = buildShareTitle(payload);
  const ogPath = `/api/og/${encodeURIComponent(params.bracketId)}${searchParamsToQuery(searchParams)}`;
  const sharePath = `/share/${encodeURIComponent(params.bracketId)}${searchParamsToQuery(searchParams)}`;

  return (
    <AppShell title={title}>
      <main
        data-testid="share-page"
        data-bracket-id={params.bracketId}
        style={{
          padding: "24px 20px 48px",
          maxWidth: 720,
          margin: "0 auto",
          color: "var(--vt-fg, #fff)",
        }}
      >
        <h1
          style={{
            fontSize: 24,
            fontWeight: 800,
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          @{payload.handle}&apos;s {payload.tournamentName} bracket
        </h1>
        <p
          style={{
            fontSize: 16,
            color: "#94a3b8",
            margin: "8px 0 16px",
          }}
        >
          Picked <strong style={{ color: "#fff" }}>{payload.winnerName}</strong>{" "}
          to lift the trophy.
        </p>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={ogPath}
          alt={title}
          width={1200}
          height={630}
          style={{
            width: "100%",
            height: "auto",
            aspectRatio: "1200 / 630",
            borderRadius: 16,
            background: "#0a0e1a",
            display: "block",
          }}
        />

        <StageRow payload={payload} />

        <div
          style={{
            marginTop: 24,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <a
            href="/world-cup-2026"
            data-testid="share-cta-make-prediction"
            style={{
              display: "inline-block",
              background: "#ff8a3d",
              color: "#0a0e1a",
              fontWeight: 800,
              padding: "14px 18px",
              borderRadius: 12,
              textAlign: "center",
              textDecoration: "none",
              fontSize: 16,
            }}
          >
            Make your prediction →
          </a>
          <a
            href={sharePath}
            data-testid="share-cta-canonical"
            rel="canonical"
            style={{
              fontSize: 13,
              color: "#64748b",
              textAlign: "center",
              textDecoration: "none",
            }}
          >
            {sharePath}
          </a>
        </div>
      </main>
    </AppShell>
  );
}
