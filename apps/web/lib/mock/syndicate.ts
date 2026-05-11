/**
 * Six baked example syndicates referenced across the marketing
 * surfaces. Stable shapes so designers, PMs, and screenshots all see
 * the same set of demo pools.
 *
 * "Vibe palette" is the syndicate's primary + accent colours, applied
 * to its hero, leaderboard rank pills, and trophy shelf. We use
 * Tournamental's existing token hues (gold, silver, sky, emerald,
 * flame, ink) so no new brand colours are introduced.
 */

export interface MockSyndicate {
  readonly slug: string;
  readonly name: string;
  readonly ownerHandle: string;
  readonly memberCount: number;
  readonly region: string;
  readonly topic: string;
  readonly vibePalette: {
    readonly primary: string;
    readonly accent: string;
  };
  /** One-line pitch shown in the hero subtitle. */
  readonly tagline: string;
  /** Days until kickoff at the time these copy were written -
   *  surfaces can render this directly until kickoff data lands. */
  readonly daysToKickoff: number;
  /** Number of picks placed across the pool so far. */
  readonly picksPlaced: number;
}

export const MOCK_SYNDICATES: readonly MockSyndicate[] = [
  {
    slug: "magnus-pool",
    name: "Magnus's Pool",
    ownerHandle: "@magnus_p",
    memberCount: 47,
    region: "Copenhagen, DK",
    topic: "Nordic football degens",
    vibePalette: { primary: "#7eb6e8", accent: "#f5c542" },
    tagline: "The friend-group bracket we've been running since 2014.",
    daysToKickoff: 31,
    picksPlaced: 412,
  },
  {
    slug: "tackle-house",
    name: "The Tackle House",
    ownerHandle: "@liam_w",
    memberCount: 128,
    region: "Manchester, UK",
    topic: "Pub league, predictions over pints",
    vibePalette: { primary: "#d8954f", accent: "#3ec27b" },
    tagline: "Every Tuesday at the Tackle House. Now the brackets count too.",
    daysToKickoff: 31,
    picksPlaced: 1107,
  },
  {
    slug: "auckland-footy-bunch",
    name: "Auckland Footy Bunch",
    ownerHandle: "@harry_w",
    memberCount: 22,
    region: "Auckland, NZ",
    topic: "Kiwi night-owls watching at 03:00 NZST",
    vibePalette: { primary: "#3ec27b", accent: "#7eb6e8" },
    tagline: "If you're tipping from a kiwi timezone you belong here.",
    daysToKickoff: 31,
    picksPlaced: 198,
  },
  {
    slug: "office-wc-2026",
    name: "Office WC 2026",
    ownerHandle: "@aaliyah_k",
    memberCount: 64,
    region: "Brooklyn, NY",
    topic: "Workplace bragging-rights pool",
    vibePalette: { primary: "#f5c542", accent: "#ff6b6b" },
    tagline: "Loser brings bagels every Monday until the next WC.",
    daysToKickoff: 31,
    picksPlaced: 528,
  },
  {
    slug: "futbol-club-familia",
    name: "Fútbol Club Familia",
    ownerHandle: "@diego_r",
    memberCount: 38,
    region: "Buenos Aires, AR",
    topic: "Three-generation family bracket",
    vibePalette: { primary: "#7eb6e8", accent: "#d8dde6" },
    tagline: "Abuela picks Argentina. Every. Single. Year.",
    daysToKickoff: 31,
    picksPlaced: 341,
  },
  {
    slug: "london-pundits",
    name: "London Pundits",
    ownerHandle: "@ellie_b",
    memberCount: 312,
    region: "London, UK",
    topic: "Verified-pundit league, analysts only",
    vibePalette: { primary: "#cdd5e7", accent: "#f5c542" },
    tagline: "Tipsters with a track record. Earn your seat.",
    daysToKickoff: 31,
    picksPlaced: 2641,
  },
];

export function findSyndicate(slug: string): MockSyndicate | undefined {
  return MOCK_SYNDICATES.find((s) => s.slug === slug);
}

export interface MockActivityEvent {
  readonly id: string;
  readonly handle: string;
  readonly verb: string;
  readonly target?: string;
  /** Human-readable relative time, e.g. "3h ago". */
  readonly when: string;
}

/**
 * Deterministic activity feed for a syndicate, 8 events, mixed verbs.
 */
export function mockActivityFeed(syndicateSlug: string): MockActivityEvent[] {
  // Hand-tuned so each syndicate page reads as plausible without being
  // random. Pure literal data avoids any chance of seed drift between
  // SSR and client hydration.
  const base: Omit<MockActivityEvent, "id">[] = [
    { handle: "@magnus_p", verb: "saved their Final pick", target: "ARG vs FRA", when: "3h ago" },
    { handle: "@aoife_o", verb: "flipped their Champion pick", target: "Brazil → Argentina", when: "1d ago" },
    { handle: "@diego_r", verb: "joined the pool", when: "2d ago" },
    { handle: "@lena_s", verb: "saved 12 group-stage picks", when: "2d ago" },
    { handle: "@harry_w", verb: "earned the Pundit badge", when: "3d ago" },
    { handle: "@sofi_m", verb: "joined the pool", when: "4d ago" },
    { handle: "@minjun_p", verb: "predicted a shock", target: "KSA over MEX", when: "5d ago" },
    { handle: "@bruno_a", verb: "created the pool", when: "1w ago" },
  ];
  return base.map((e, i) => ({ ...e, id: `${syndicateSlug}-${i}` }));
}
