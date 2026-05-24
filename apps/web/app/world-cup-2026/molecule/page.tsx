/**
 * /world-cup-2026/molecule, the 3D Obsidian-style atom map of the user's
 * tournament prediction.
 *
 * Server component: loads the canonical 48-team fixture set + enriches with
 * kit colours / flag emoji so the client scene can render the molecule
 * without an extra fetch. The actual R3F scene is a client child
 * (`MoleculePageClient` -> `MoleculeScene`).
 *
 * Cache policy: this is a per-user surface (the molecule changes with
 * every bracket pick) but the *initial HTML* doesn't depend on the user's
 * bracket, that's read from localStorage on the client. So the page is
 * safe to cache aggressively at the edge: `public, s-maxage=600,
 * stale-while-revalidate=86400`. The Next.js `revalidate` export below
 * pins the same on the framework side.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { loadFixtures2026 } from "@tournamental/bracket-engine";

import { RouteEvent } from "@/components/analytics/RouteEvent";
import { AppShell } from "@/components/shell";
import canonicalTeamsRaw from "@/../../data/fifa-wc-2026/teams.json";
import { enrichTournamentTeams, type CanonicalTeamsFile } from "@/lib/bracket/enrich";

import { MoleculePageClient } from "./_components/MoleculePageClient";

// Force dynamic so the AppShell title localises per request. Previously
// revalidate=600 worked for English-only; with 22 locales a single
// cached HTML would lie to non-English visitors. The Three/R3F scene
// itself is client-only and doesn't depend on this.
export const dynamic = "force-dynamic";

const OG_IMAGE = "/og/bracket/default.png";

export const metadata: Metadata = {
  title: "Tournament Molecule, Football World Cup 2026",
  description:
    "Your bracket prediction, rendered as a 3D atom map. Group losers on the outer ring, your predicted champion at the heart. Click any team to inspect their predicted path.",
  openGraph: {
    title: "Tournament Molecule, World Cup 2026",
    description: "Your bracket prediction as a 3D molecule. Click any team to inspect.",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Tournamental molecule" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tournament Molecule, World Cup 2026",
    description: "Your bracket prediction as a 3D molecule.",
    images: [OG_IMAGE],
  },
};

async function safeT(key: string, fallback: string): Promise<string> {
  try {
    const t = await getTranslations();
    const out = t(key);
    return out === key ? fallback : out;
  } catch {
    return fallback;
  }
}

export default async function WorldCup2026MoleculePage() {
  const base = loadFixtures2026();
  const tournament = enrichTournamentTeams(
    base,
    canonicalTeamsRaw as CanonicalTeamsFile,
  );
  const title = await safeT("molecule.page_title", "Molecule");

  return (
    <AppShell title={title} showBottomNav>
      <RouteEvent name="molecule.opened" />
      <MoleculePageClient tournament={tournament} />
    </AppShell>
  );
}
