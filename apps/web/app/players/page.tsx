/**
 * /players, index of every confirmed WC2026 player with search + filters.
 *
 * Server component shell: loads the (~1k row) static dataset and the team
 * lookup, hands them to the client `<PlayerIndex />` for interactive
 * filter + search.
 *
 * SEO: rendered on the server with the unfiltered list, so crawlers see
 * every player as a card link.
 */

import type { Metadata } from "next";

import { AppShell } from "@/components/shell";
import { allPlayers, datasetMeta, distinctClubs, distinctCodes } from "@/lib/players";

import canonicalTeamsRaw from "@/../../data/fifa-wc-2026/teams.json";

import { PlayerIndex } from "./PlayerIndex";

import "@/components/player/player.css";

interface CanonicalTeam {
  readonly code: string;
  readonly name: string;
  readonly flag_emoji?: string;
}

interface CanonicalTeamsFile {
  readonly teams: readonly CanonicalTeam[];
}

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Players - Football World Cup 2026 | Tournamental",
  description:
    "Search every confirmed player at the Football World Cup 2026. Filter by team, position, or club. 1056 records, public-domain headshots from Wikidata.",
  alternates: { canonical: "/players" },
};

export default function PlayersIndexPage() {
  const players = allPlayers();
  const teamFile = canonicalTeamsRaw as CanonicalTeamsFile;
  const teamOptions = teamFile.teams.map((t) => ({
    code: t.code,
    name: t.name,
    flag: t.flag_emoji ?? "",
  }));
  const meta = datasetMeta();
  return (
    <AppShell title="Players">
      <main className="player-page" data-testid="players-index-page">
        <h1
          style={{
            margin: "1.5rem 0 0.5rem",
            fontSize: "clamp(1.5rem, 4vw, 2rem)",
            letterSpacing: "-0.01em",
          }}
        >
          World Cup 2026 players
        </h1>
        <p style={{ color: "#94a3b8", margin: "0 0 1rem", fontSize: "0.95rem" }}>
          {meta.count.toLocaleString()} players across {distinctCodes().length} qualified teams. Source: {meta.source}.
        </p>
        <PlayerIndex
          players={players}
          teamOptions={teamOptions}
          clubOptions={distinctClubs()}
        />
      </main>
    </AppShell>
  );
}
