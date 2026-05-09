/**
 * /world-cup-2026 — the bracket-prophet page for the FIFA WC 2026.
 *
 * Server component: emits OG meta tags + loads the vendored fixture JSON
 * once, server-side. The interactive bracket is a client island.
 *
 * Cache policy: this is a marketing-flavoured surface (the same content
 * is shown to every unauthenticated visitor). `Cache-Control` set to
 * `public, s-maxage=300, stale-while-revalidate=86400` per the standing
 * rule in CLAUDE.md (long edge cache + SWR for marketing pages).
 */

import type { Metadata } from "next";

import { loadFixtures2026 } from "@vtorn/bracket-engine";

import { BracketBuilder } from "@/components/bracket/BracketBuilder";
import { enrichTournamentTeams, type CanonicalTeamsFile } from "@/lib/bracket/enrich";
import canonicalTeamsRaw from "@/../../data/fifa-wc-2026/teams.json";
import "./bracket.css";

export const dynamic = "force-static";

const SHARE_DEFAULT_OG = "/og/bracket/default.png";

export const metadata: Metadata = {
  title: "VTourn Bracket Prophet — FIFA World Cup 2026",
  description:
    "Predict the full 48-team bracket. Earlier locked long-shots earn more points. Powered by the VTourn cascade engine — your downstream tree updates instantly with every pick.",
  openGraph: {
    title: "VTourn Bracket Prophet — FIFA World Cup 2026",
    description:
      "Lock your bracket before kickoff. Long-shots locked early earn the most.",
    images: [{ url: SHARE_DEFAULT_OG, width: 1200, height: 630, alt: "VTourn Bracket" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "VTourn Bracket Prophet — FIFA World Cup 2026",
    description:
      "Lock your bracket before kickoff. Long-shots locked early earn the most.",
    images: [SHARE_DEFAULT_OG],
  },
};

export default function WorldCup2026Page() {
  const baseTournament = loadFixtures2026();
  const tournament = enrichTournamentTeams(
    baseTournament,
    canonicalTeamsRaw as CanonicalTeamsFile,
  );

  return (
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
    </main>
  );
}
