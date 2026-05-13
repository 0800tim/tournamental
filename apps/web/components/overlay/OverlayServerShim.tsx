/**
 * OverlayServerShim, server-renders the active overlay's title +
 * canonical link inline on the page so search-engine crawlers (which
 * generally don't run JS) and link-preview bots see real HTML for the
 * deep-link variant of a URL.
 *
 * The shim is purely a fallback for crawlers + screen readers on
 * cold-load: the client OverlayProvider hydrates the URL on mount and
 * renders the actual interactive sheet via OverlayRoot, at which point
 * the shim is hidden (`.vt-overlay-server-shim` clips it offscreen
 * with `position: absolute; left: -10000px`). We keep the markup
 * present, however, so screen readers + crawlers can still parse it.
 *
 * What we DON'T do here: render the full team / match content
 * server-side as the overlay. The full pages already exist as real
 * routes (`/team/[code]`, `/match/[id]/preview`); the share preview
 * meta + canonical link give crawlers everything they need.
 *
 * Usage (in a server component, e.g. world-cup-2026/page.tsx):
 *
 *   <OverlayServerShim searchParams={searchParams} />
 *
 * `searchParams` is the standard Next.js page-prop. If no overlay is
 * encoded in the URL, the shim renders nothing.
 */

import Link from "next/link";

import { parseOverlayUrl } from "./url";
import { canonicalTeamByCode } from "@/app/team/[code]/_lib/team-data";
import { canonicalTeam, resolveMatch } from "@/app/match/[id]/preview/_lib/match-data";
import { loadFixtures2026 } from "@tournamental/bracket-engine";
import { enrichTournamentTeams, type CanonicalTeamsFile } from "@/lib/bracket/enrich";
import canonicalTeamsRaw from "@/../../data/fifa-wc-2026/teams.json";

interface OverlayServerShimProps {
  /** The page's `searchParams` prop from Next.js. */
  readonly searchParams?: Record<string, string | string[] | undefined>;
}

function searchParamsToString(
  sp: Record<string, string | string[] | undefined> | undefined,
): string {
  if (!sp) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const x of v) usp.append(k, x);
    } else {
      usp.append(k, v);
    }
  }
  return usp.toString();
}

export function OverlayServerShim(props: OverlayServerShimProps) {
  const stack = parseOverlayUrl(searchParamsToString(props.searchParams));
  if (stack.length === 0) return null;

  // The top frame is the "primary" overlay for SEO purposes.
  const top = stack[stack.length - 1]!;

  if (top.kind === "team") {
    const upper = (top.params.code ?? "").toUpperCase();
    const canonical = canonicalTeamByCode(upper);
    if (!canonical) return null;
    return (
      <aside
        className="vt-overlay-server-shim"
        data-overlay-server-shim="team"
        aria-label={`Server-rendered overlay shim for ${canonical.name}`}
      >
        <h2>{canonical.name}</h2>
        <p>
          World #{canonical.fifa_ranking_at_2026} · {canonical.confederation}
          {canonical.manager ? ` · Manager: ${canonical.manager}` : ""}
        </p>
        <p>
          <Link href={`/team/${upper}`}>
            Open the full {canonical.name} team page
          </Link>
        </p>
      </aside>
    );
  }

  if (top.kind === "match") {
    const id = top.params.id ?? "";
    const tournament = enrichTournamentTeams(
      loadFixtures2026(),
      canonicalTeamsRaw as CanonicalTeamsFile,
    );
    const match = resolveMatch(tournament, id);
    if (!match) return null;
    const home = match.homeCode ? canonicalTeam(match.homeCode) : undefined;
    const away = match.awayCode ? canonicalTeam(match.awayCode) : undefined;
    const homeName = home?.name ?? match.homeCode ?? "TBD";
    const awayName = away?.name ?? match.awayCode ?? "TBD";
    return (
      <aside
        className="vt-overlay-server-shim"
        data-overlay-server-shim="match"
        aria-label={`Server-rendered overlay shim for ${homeName} vs ${awayName}`}
      >
        <h2>
          {homeName} vs {awayName}
        </h2>
        <p>
          {match.stageLabel} ·{" "}
          <time dateTime={match.kickoffUtc}>{match.kickoffUtc}</time>
          {match.venue ? ` · ${match.venue}` : ""}
        </p>
        <p>
          <Link href={`/match/${match.matchId}/preview`}>
            Open the full match preview
          </Link>
        </p>
      </aside>
    );
  }

  if (top.kind === "leaderboard-entry") {
    const bracketId = top.params.bracketId ?? "";
    return (
      <aside
        className="vt-overlay-server-shim"
        data-overlay-server-shim="leaderboard-entry"
      >
        <h2>{top.params.name ?? `Bracket ${bracketId}`}</h2>
        <p>
          <Link href={`/world-cup-2026/share/${bracketId}`}>
            View this bracket
          </Link>
        </p>
      </aside>
    );
  }

  return null;
}
