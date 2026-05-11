/**
 * /world-cup-2026, the bracket-prophet page for the FIFA WC 2026.
 *
 * Server component: emits OG meta tags + loads the vendored fixture JSON
 * once, server-side. The interactive bracket is a client island wrapped
 * in:
 *   - <AppShell>           (PWA shell from #106, top app-bar + bottom nav)
 *   - <BracketOverlayShell> (this PR, overlay router + breadcrumb + root)
 *
 * Cache policy: this is a marketing-flavoured surface. The page is
 * `force-dynamic` because the OverlayServerShim reads searchParams,
 * but the underlying content doesn't actually vary by searchParams -
 * a single edge cache entry with `Cache-Control: public, s-maxage=300,
 * stale-while-revalidate=86400` covers `/world-cup-2026` and every
 * `?overlay=...` deep-link variant. See docs/22-deployment-and-tunnels.md
 * row for "Bracket overlay deep-link".
 */

import type { Metadata } from "next";

import { loadFixtures2026 } from "@vtorn/bracket-engine";

import { BracketBuilder } from "@/components/bracket/BracketBuilder";
import { AppShell } from "@/components/shell";
import { OverlayServerShim } from "@/components/overlay/OverlayServerShim";
import { BracketOverlayShell } from "@/components/overlay/BracketOverlayShell";
import { enrichTournamentTeams, type CanonicalTeamsFile } from "@/lib/bracket/enrich";
import canonicalTeamsRaw from "@/../../data/fifa-wc-2026/teams.json";
import "./bracket.css";

// Force-dynamic so we can read searchParams server-side (the overlay
// server-rendered shim consumes them). Cache-Control headers from the
// CDN still kick in, so this is "dynamic-ish" only at the framework
// level, actual edge caching is unaffected.
export const dynamic = "force-dynamic";

const SHARE_DEFAULT_OG = "/og/bracket/default.png";

export const metadata: Metadata = {
  title: "Tournamental Bracket Prophet, FIFA World Cup 2026",
  description:
    "Predict the full 48-team bracket. Tweak picks match by match, earlier-saved long-shots earn more points. Powered by the Tournamental cascade engine, your downstream tree updates instantly with every pick.",
  openGraph: {
    title: "Tournamental Bracket Prophet, FIFA World Cup 2026",
    description:
      "Save your bracket. Change any pick until that match kicks off. Earlier-saved long-shots earn the most.",
    images: [{ url: SHARE_DEFAULT_OG, width: 1200, height: 630, alt: "Tournamental Bracket" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tournamental Bracket Prophet, FIFA World Cup 2026",
    description:
      "Save your bracket. Change any pick until that match kicks off. Earlier-saved long-shots earn the most.",
    images: [SHARE_DEFAULT_OG],
  },
};

interface WorldCup2026PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export default function WorldCup2026Page({ searchParams }: WorldCup2026PageProps) {
  const baseTournament = loadFixtures2026();
  const tournament = enrichTournamentTeams(
    baseTournament,
    canonicalTeamsRaw as CanonicalTeamsFile,
  );

  return (
    <AppShell title="Tournament">
      <BracketOverlayShell pageLabel="World Cup 2026" pageHref="/world-cup-2026">
        <main className="bracket-page">
          <BracketBuilder tournament={tournament} />
          <footer className="bracket-page-footer">
            <p>
              Engine: <code>@vtorn/bracket-engine</code>. Source data:{" "}
              <a href={baseTournament._meta.source_url} target="_blank" rel="noreferrer">
                FIFA 2026
              </a>{" "}
              ({baseTournament._meta.schedule_status}). When the official draw is
              finalised, swap the fixtures JSON.
            </p>
          </footer>
          <OverlayServerShim searchParams={searchParams} />
        </main>
      </BracketOverlayShell>
    </AppShell>
  );
}
