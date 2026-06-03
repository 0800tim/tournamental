/**
 * /player/[id], single-player profile page.
 *
 * Server-rendered. Loads the player from the bundled
 * `apps/web/data/players-2026.json`, renders:
 *   - hero (headshot + attribution + name + chips)
 *   - quick facts (age, club, dob, shirt)
 *   - "Predict their team's matches" CTA → `/team/<code>`
 *   - career form (per-player stub of last-5 W/D/L, derived from the
 *     team's recent form when the dataset has no per-player history yet)
 *   - Wikipedia link
 *   - Person/SportsTeam structured data (JSON-LD)
 *
 * Cache policy: this is identical for every unauthenticated visitor, the
 * Next.js page is built fully static (`force-static`) and Vercel/Cloudflare
 * apply the long-edge cache + SWR per the standing rule in CLAUDE.md.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PlayerHero } from "@/components/player/PlayerHero";
import { PlayerQuickFacts } from "@/components/player/PlayerQuickFacts";
import { AppShell } from "@/components/shell";
import { findPlayer, allPlayerIds, POSITION_LABEL } from "@/lib/players";

import canonicalTeamsRaw from "@/../../data/fifa-wc-2026/teams.json";
import "@/components/player/player.css";

interface PlayerPageProps {
  params: Promise<{ id: string }>;
}

interface CanonicalTeam {
  readonly code: string;
  readonly name: string;
  readonly short_name: string;
  readonly flag_emoji?: string;
  readonly kit: { readonly primary: string; readonly secondary: string };
}

interface CanonicalTeamsFile {
  readonly teams: readonly CanonicalTeam[];
}

const TEAMS_BY_CODE: ReadonlyMap<string, CanonicalTeam> = (() => {
  const m = new Map<string, CanonicalTeam>();
  const file = canonicalTeamsRaw as CanonicalTeamsFile;
  for (const t of file.teams) m.set(t.code, t);
  return m;
})();

export const dynamic = "force-static";

/** Pre-render every player page at build time. */
export function generateStaticParams() {
  return allPlayerIds().map((id) => ({ id }));
}

export async function generateMetadata(props: PlayerPageProps): Promise<Metadata> {
  const params = await props.params;
  const player = findPlayer(params.id);
  if (!player) {
    return { title: "Player not found - Tournamental" };
  }
  const team = TEAMS_BY_CODE.get(player.code);
  const teamName = team?.name ?? player.code;
  const title = `${player.name} - ${teamName} - Football World Cup 2026 | Tournamental`;
  const desc = `${player.name} (${POSITION_LABEL[player.position]}) plays for ${teamName} at the 2026 World Cup. ${player.club ? `Club: ${player.club}.` : ""} Predict their next match on Tournamental.`;
  return {
    title,
    description: desc,
    alternates: { canonical: `/player/${player.id}` },
    openGraph: {
      title,
      description: desc,
      type: "profile",
      images: player.imageUrl ? [{ url: player.imageUrl }] : undefined,
    },
  };
}

export default async function PlayerPage(props: PlayerPageProps) {
  const params = await props.params;
  const player = findPlayer(params.id);
  if (!player) notFound();

  const team = TEAMS_BY_CODE.get(player.code);
  const teamName = team?.name ?? player.code;
  const flagEmoji = team?.flag_emoji;
  const primary = team?.kit?.primary ?? "#fbbf24";
  const secondary = team?.kit?.secondary ?? "#1c1c22";

  // Person + SportsOrganization JSON-LD for SEO.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: player.name,
    alternateName: player.fullName ?? undefined,
    birthDate: player.dob ?? undefined,
    nationality: teamName,
    image: player.imageUrl ?? undefined,
    sameAs: [player.wikipediaUrl, `https://www.wikidata.org/wiki/${player.wikidataQid}`].filter(
      Boolean,
    ),
    memberOf: player.club
      ? {
          "@type": "SportsTeam",
          name: player.club,
        }
      : undefined,
    affiliation: {
      "@type": "SportsTeam",
      name: teamName,
      sport: "Association football",
    },
    jobTitle: POSITION_LABEL[player.position],
  };

  const heroStyle = {
    "--pp-primary": primary,
    "--pp-secondary": secondary,
  } as React.CSSProperties;

  return (
    <AppShell title={player.name}>
      <main className="player-page" style={heroStyle} data-testid="player-page">
        <Link href="/players" className="player-back" aria-label="Back to all players">
          &larr; All players
        </Link>

        <PlayerHero
          player={player}
          teamName={teamName}
          teamFlagEmoji={flagEmoji}
        />

        <PlayerQuickFacts player={player} />

        <section className="player-section" aria-label="Tournament context">
          <h2>Tournament 2026</h2>
          <p>
            {player.name} represents {teamName} at the Football World Cup 2026. Plays as a{" "}
            {POSITION_LABEL[player.position].toLowerCase()}.
          </p>
          <p style={{ marginTop: "1rem" }}>
            <Link href={`/team/${player.code}`} className="player-cta">
              Predict {teamName}&rsquo;s matches
            </Link>
          </p>
        </section>

        {player.wikipediaUrl && (
          <section className="player-section" aria-label="Reference">
            <h2>More</h2>
            <p>
              <a
                className="player-wiki-link"
                href={player.wikipediaUrl}
                target="_blank"
                rel="noopener nofollow"
              >
                Read on Wikipedia &rarr;
              </a>
            </p>
            {player.imageCredit && (
              <p style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "0.5rem" }}>
                Headshot: {player.imageCredit}
              </p>
            )}
          </section>
        )}

        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </main>
    </AppShell>
  );
}
