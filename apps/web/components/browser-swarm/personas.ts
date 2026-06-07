/**
 * Bot-persona helper.
 *
 * Tim 2026-06-07: the /run/bots list used to surface "Italy" alongside
 * other persona flags even though Italy isn't in the FIFA WC 2026 field.
 * The fix is a derived persona pool that filters MOCK_NAMES down to
 * (and aligns code-style with) the 48 nations actually competing in the
 * tournament. Anywhere a bot needs a country flavour, source it from
 * `WC2026_PERSONAS` instead of MOCK_NAMES directly.
 *
 * This file is intentionally a thin derivation. The MOCK_NAMES source of
 * truth keeps its broader ~50-row list for non-bot surfaces (sample
 * leaderboards on marketing pages, etc.). Bot-builder surfaces consume
 * the filtered view.
 */

import { MOCK_NAMES, type MockName } from "@/lib/mock/names";

/**
 * FIFA codes for the 48 nations in the 2026 World Cup. Sourced from
 * `packages/bracket-engine/data/fifa-wc-2026-fixtures.json`. Kept here
 * as a small constant so this file has no runtime dependency on the
 * full fixtures JSON; if the field changes, update this list.
 */
export const WC2026_TEAM_CODES: ReadonlySet<string> = new Set<string>([
  "ALG", "ARG", "AUS", "AUT", "BEL", "BIH", "BRA", "CAN", "CIV", "COD",
  "COL", "CPV", "CRO", "CUW", "CZE", "ECU", "EGY", "ENG", "ESP", "FRA",
  "GER", "GHA", "HAI", "IRN", "IRQ", "JOR", "JPN", "KOR", "KSA", "MAR",
  "MEX", "NED", "NOR", "NZL", "PAN", "PAR", "POR", "QAT", "RSA", "SCO",
  "SEN", "SUI", "SWE", "TUN", "TUR", "URU", "USA", "UZB",
]);

/**
 * MOCK_NAMES uses ISO-3166 alpha-3 country codes; the bracket-engine
 * fixtures use FIFA country codes. They differ for several nations
 * (Germany, Netherlands, Portugal, Uruguay, Saudi Arabia, ...). This
 * map translates ISO codes to FIFA codes so a persona's country lines
 * up with what shows on the bracket / fixture list.
 */
const ISO_TO_FIFA: Readonly<Record<string, string>> = {
  DEU: "GER",
  NLD: "NED",
  PRT: "POR",
  URY: "URU",
  SAU: "KSA",
  // Identity for the rest, listed here for explicitness so an audit
  // doesn't have to read between the lines.
  ARG: "ARG", BRA: "BRA", FRA: "FRA", ENG: "ENG", ESP: "ESP",
  JPN: "JPN", MEX: "MEX", USA: "USA", KOR: "KOR", MAR: "MAR",
  EGY: "EGY", AUS: "AUS", CAN: "CAN", SEN: "SEN", IRN: "IRN",
  TUN: "TUN", ECU: "ECU", GHA: "GHA",
};

function toFifa(iso: string): string | null {
  return ISO_TO_FIFA[iso] ?? null;
}

/**
 * The bot-builder's persona pool. Same shape as MOCK_NAMES, with the
 * `country` field normalised to a FIFA code and any persona whose
 * nation isn't in the WC2026 field dropped. Italy, Ireland, Denmark,
 * Nigeria, and Costa Rica are filtered out for the 2026 edition.
 */
export const WC2026_PERSONAS: readonly MockName[] = MOCK_NAMES
  .map((p): MockName | null => {
    const fifa = toFifa(p.country);
    if (!fifa || !WC2026_TEAM_CODES.has(fifa)) return null;
    return { ...p, country: fifa };
  })
  .filter((p): p is MockName => p !== null);

/**
 * Deterministic persona picker for a given bot index. Pure FNV-1a, no
 * Math.random, so the /run/bots list shows the same persona for the
 * same bot index across renders + devices.
 */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(input: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

export function personaForBot(masterSeed: string, botIndex: number): MockName {
  const pool = WC2026_PERSONAS;
  if (pool.length === 0) {
    // Should never happen, defensive default.
    return { name: "Bot", handle: "@bot", country: "USA", flag: "🇺🇸" };
  }
  const h = fnv1a(`${masterSeed}::persona::${botIndex}`);
  return pool[h % pool.length]!;
}

/**
 * Each bot also gets a "darling team" they're sentimentally biased
 * toward. Used to keep cup-winner distributions from collapsing on
 * the chalk leader. Long-shot darlings are deliberately sampled with
 * a softer bias so we get a fan-out across favourites instead of a
 * uniform spread.
 *
 * The pool is the 48 WC2026 teams. The bias toward stronger sides is
 * gentle (rank^0.5 weighting), so a top-ten side is favoured but a
 * dark horse like Norway or Switzerland still gets picked enough
 * times to break up the chalk monopoly.
 */
export function darlingTeamForBot(
  masterSeed: string,
  botIndex: number,
  rankedTeams: ReadonlyArray<{ team: string; rank: number }>,
): string {
  if (rankedTeams.length === 0) return "ARG";
  // Soft weighting: weight = 1 / sqrt(rank). Top-ranked side has
  // weight 1; rank-48 side has weight ~0.144. The cumulative-pick
  // then samples with the bot's deterministic seed.
  const weights = rankedTeams.map((t) => 1 / Math.sqrt(Math.max(1, t.rank)));
  const total = weights.reduce((s, x) => s + x, 0);
  const h = fnv1a(`${masterSeed}::darling::${botIndex}`);
  const r = (h / 0x1_0000_0000) * total;
  let acc = 0;
  for (let i = 0; i < rankedTeams.length; i++) {
    acc += weights[i]!;
    if (r < acc) return rankedTeams[i]!.team;
  }
  return rankedTeams[rankedTeams.length - 1]!.team;
}
