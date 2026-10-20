/**
 * Tournament registry: the single place that says which tournament is
 * ACTIVE (served at play.tournamental.com), which is UPCOMING (the hub
 * promotes it and collects register-interest), and which are ARCHIVED
 * (served read-only on their own hostname).
 *
 * This module is imported by middleware.ts (edge runtime), so it must
 * stay dependency-free and side-effect-free: plain data and pure
 * functions only. No node: imports, no DB.
 *
 * To take the next tournament live: add its entry with status "active"
 * and its slug routes. Middleware stops redirecting play.* to the hub
 * the moment activeTournament() returns non-null. Nothing else moves.
 *
 * Added 2026-10-16 with the FWC 2026 archive + RWC 2027 hub
 * (docs/briefs/2026-10-15-plan-archive-hub-marketing.md).
 */

export type TournamentStatus = "active" | "upcoming" | "archived";

export interface TournamentStat {
  readonly label: string;
  /** Always a percentage or a rank, never a raw count (Tim 2026-10-15). */
  readonly value: string;
  readonly note?: string;
}

export interface TournamentEntry {
  /** Internal id, matches game.db tournament_id where one exists. */
  readonly id: string;
  /** URL-safe short slug used in hostnames and paths (e.g. fwc2026). */
  readonly slug: string;
  readonly name: string;
  readonly shortName: string;
  readonly sport: "football" | "rugby-union";
  readonly hostCountry: string;
  readonly startsUtc: string;
  readonly endsUtc: string;
  readonly status: TournamentStatus;
  /** Short badge for titles, the AppBar and OG images: "FWC2026". */
  readonly code: string;
  /** Path family the tournament's pages live under: "/world-cup-2026". */
  readonly routeBase: string;
  /** Public folder for hub and hero art, with slashes: "/rwc2027/". */
  readonly artDir?: string;
  /** Extra hostnames that 301 to the archive host (archived only). */
  readonly aliasHosts?: readonly string[];
  /** The retro page on tournamental.com: "/archive/fwc-2026". */
  readonly marketingArchivePath?: string;
  /** Hostname that serves the read-only archive (archived only). */
  readonly archiveHost?: string;
  /** Trademark owner line used in disclaimers. */
  readonly trademarkLine: string;
  readonly teams?: number;
  readonly matches?: number;
  readonly hostCities?: readonly string[];
  readonly winner?: { readonly code: string; readonly name: string };
  readonly runnerUp?: { readonly code: string; readonly name: string };
  readonly third?: { readonly code: string; readonly name: string };
  readonly finalScoreline?: string;
  /** Public engagement stats, percentages only. */
  readonly stats?: readonly TournamentStat[];
}

export const TOURNAMENTS: readonly TournamentEntry[] = [
  {
    id: "fifa-wc-2026",
    slug: "fwc2026",
    name: "FIFA World Cup 2026™",
    shortName: "FWC 2026",
    sport: "football",
    hostCountry: "United States, Canada and Mexico",
    startsUtc: "2026-06-11T19:00:00Z",
    endsUtc: "2026-07-19T19:00:00Z",
    status: "archived",
    code: "FWC2026",
    routeBase: "/world-cup-2026",
    aliasHosts: ["wc2026.tournamental.com", "2026wc.tournamental.com"],
    marketingArchivePath: "/archive/fwc-2026",
    archiveHost: "fwc2026.tournamental.com",
    trademarkLine:
      "FIFA World Cup 2026™ is a trademark of Fédération Internationale de Football Association. Tournamental is independent and not affiliated with FIFA.",
    teams: 48,
    matches: 104,
    winner: { code: "ESP", name: "Spain" },
    runnerUp: { code: "ARG", name: "Argentina" },
    third: { code: "ENG", name: "England" },
    finalScoreline: "Spain 1, Argentina 0 (after extra time)",
    // Derived 2026-10-16 from the production game.db (read-only). Raw
    // counts stay out of the product on purpose; the derivations are
    // recorded in docs/briefs/2026-10-15-plan-archive-hub-marketing.md.
    stats: [
      { label: "Players who saved a bracket", value: "78%" },
      { label: "Players who joined or ran a pool", value: "69%" },
      { label: "Tournament weeks with new picks saved", value: "100%" },
      { label: "Matches settled on the ledger", value: "100%" },
      { label: "Best bracket, matches called correctly", value: "69%" },
      { label: "Average bracket, matches called correctly", value: "52%" },
      { label: "Perfect brackets", value: "0%", note: "Nobody called all 104." },
    ],
  },
  {
    id: "rwc-2027",
    slug: "rwc2027",
    name: "Rugby World Cup 2027™",
    shortName: "RWC 2027",
    sport: "rugby-union",
    hostCountry: "Australia",
    startsUtc: "2027-10-01T09:00:00Z",
    endsUtc: "2027-11-13T09:00:00Z",
    status: "upcoming",
    code: "RWC2027",
    routeBase: "/rwc-2027",
    artDir: "/rwc2027/",
    trademarkLine:
      "Rugby World Cup™ and Rugby World Cup 2027™ are trademarks of Rugby World Cup Limited. Tournamental is independent and not affiliated with, endorsed by, or sponsored by World Rugby or Rugby World Cup Limited.",
    teams: 24,
    matches: 52,
    hostCities: [
      "Adelaide",
      "Brisbane",
      "Melbourne",
      "Newcastle",
      "Perth",
      "Sydney",
      "Townsville",
    ],
  },
];

export function activeTournament(): TournamentEntry | null {
  return TOURNAMENTS.find((t) => t.status === "active") ?? null;
}

export function upcomingTournament(): TournamentEntry | null {
  return TOURNAMENTS.find((t) => t.status === "upcoming") ?? null;
}

export function archivedTournaments(): readonly TournamentEntry[] {
  return TOURNAMENTS.filter((t) => t.status === "archived");
}

export function tournamentBySlug(slug: string): TournamentEntry | null {
  return TOURNAMENTS.find((t) => t.slug === slug) ?? null;
}

/** Map an incoming hostname to the archived tournament it serves. */
export function archiveForHost(host: string): TournamentEntry | null {
  const h = host.toLowerCase();
  for (const t of TOURNAMENTS) {
    if (t.status !== "archived" || !t.archiveHost) continue;
    if (h === t.archiveHost || h === `${t.slug}.localhost`) return t;
  }
  return null;
}

/**
 * The slice of an entry the shell chrome needs, safe to hand to client
 * components (no stats, no results). Carried by ShellModeProvider.
 */
export interface TournamentSummary {
  readonly slug: string;
  readonly code: string;
  readonly name: string;
  readonly shortName: string;
  readonly routeBase: string;
  readonly archiveHost: string | null;
  readonly endsUtc: string;
}

export function summarise(t: TournamentEntry | null | undefined): TournamentSummary | null {
  if (!t) return null;
  return {
    slug: t.slug,
    code: t.code,
    name: t.name,
    shortName: t.shortName,
    routeBase: t.routeBase,
    archiveHost: t.archiveHost ?? null,
    endsUtc: t.endsUtc,
  };
}

/**
 * The entry the live shell is about: the active tournament, or, with
 * nothing active, the newest archived one (its route family is what
 * the play host still serves). Never the upcoming entry: that one has
 * no pages yet.
 */
export function chromeTournament(): TournamentEntry | null {
  const archived = archivedTournaments();
  return activeTournament() ?? archived[archived.length - 1] ?? null;
}
