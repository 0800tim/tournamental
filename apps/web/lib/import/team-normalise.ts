/**
 * Normalise a team name from a rival platform's bracket page to our
 * canonical 3-letter team code (FIFA / ISO style, e.g. "ARG", "ENG").
 *
 * Source platforms use a wild mix of representations:
 *   - Full English name: "Argentina", "South Korea", "United States"
 *   - ISO-3 code: "ARG", "KOR", "USA"
 *   - FIFA short-code: "KOR" (Korea Republic), "PRK" (Korea DPR)
 *   - Flag emoji: "🇦🇷"
 *   - Common nicknames: "South Korea" vs "Korea Republic" vs "S Korea"
 *   - Stripped diacritics: "Cote d'Ivoire" vs "Côte d'Ivoire"
 *
 * The alias table below resolves all of these to one canonical code.
 * Add new entries as we encounter new variants in fixture HTML.
 *
 * The 48 teams listed are the FIFA World Cup 2026 group-stage qualifiers
 * per apps/web/app/api/og/bracket-birdseye/route.ts. Any team not in
 * that set returns null and the wizard preview flags the row.
 */

const TEAM_CODES = [
  "ARG", "AUS", "BEL", "BRA", "BIH", "CAN", "CIV", "COL", "COD", "CPV",
  "CRO", "CUW", "CZE", "ECU", "EGY", "ENG", "ESP", "FRA", "GER", "GHA",
  "HAI", "IRN", "IRQ", "JOR", "JPN", "KOR", "KSA", "MAR", "MEX", "NED",
  "NOR", "NZL", "PAN", "PAR", "POR", "QAT", "RSA", "SCO", "SEN", "SUI",
  "SWE", "TUN", "TUR", "URU", "USA", "UZB", "ALG",
] as const;

export type TeamCode = (typeof TEAM_CODES)[number];

/**
 * Reverse alias table: every name we might receive maps to a TeamCode.
 * Keys are lowercased + stripped of diacritics + punctuation; values
 * are the canonical 3-letter code.
 */
const ALIASES: Record<string, TeamCode> = {
  // Argentina
  arg: "ARG", argentina: "ARG", argentinian: "ARG", "🇦🇷": "ARG",
  // Australia
  aus: "AUS", australia: "AUS", australian: "AUS", socceroos: "AUS", "🇦🇺": "AUS",
  // Belgium
  bel: "BEL", belgium: "BEL", "red devils": "BEL", "🇧🇪": "BEL",
  // Brazil
  bra: "BRA", brazil: "BRA", brasil: "BRA", brazilian: "BRA", selecao: "BRA", "🇧🇷": "BRA",
  // Bosnia & Herzegovina
  bih: "BIH", bosnia: "BIH", "bosnia and herzegovina": "BIH", "bosnia & herzegovina": "BIH", "🇧🇦": "BIH",
  // Canada
  can: "CAN", canada: "CAN", canadian: "CAN", "🇨🇦": "CAN",
  // Cote d'Ivoire
  civ: "CIV", "cote d ivoire": "CIV", "cote divoire": "CIV", "côte d ivoire": "CIV", "ivory coast": "CIV", "🇨🇮": "CIV",
  // Colombia
  col: "COL", colombia: "COL", "🇨🇴": "COL",
  // DR Congo
  cod: "COD", "dr congo": "COD", "democratic republic of the congo": "COD", "democratic republic of congo": "COD", "drc": "COD", "🇨🇩": "COD",
  // Cape Verde
  cpv: "CPV", "cape verde": "CPV", "cabo verde": "CPV", "🇨🇻": "CPV",
  // Croatia
  cro: "CRO", croatia: "CRO", hrvatska: "CRO", "🇭🇷": "CRO",
  // Curacao
  cuw: "CUW", curacao: "CUW", "curaçao": "CUW", "🇨🇼": "CUW",
  // Czech Republic / Czechia
  cze: "CZE", czech: "CZE", "czech republic": "CZE", czechia: "CZE", "🇨🇿": "CZE",
  // Ecuador
  ecu: "ECU", ecuador: "ECU", "🇪🇨": "ECU",
  // Egypt
  egy: "EGY", egypt: "EGY", pharaohs: "EGY", "🇪🇬": "EGY",
  // England
  eng: "ENG", england: "ENG", "three lions": "ENG", "🏴󠁧󠁢󠁥󠁮󠁧󠁿": "ENG",
  // Spain
  esp: "ESP", spain: "ESP", espana: "ESP", "españa": "ESP", "la roja": "ESP", "🇪🇸": "ESP",
  // France
  fra: "FRA", france: "FRA", "les bleus": "FRA", "🇫🇷": "FRA",
  // Germany
  ger: "GER", germany: "GER", deutschland: "GER", die_mannschaft: "GER", "die mannschaft": "GER", "🇩🇪": "GER",
  // Ghana
  gha: "GHA", ghana: "GHA", "black stars": "GHA", "🇬🇭": "GHA",
  // Haiti
  hai: "HAI", haiti: "HAI", "🇭🇹": "HAI",
  // Iran
  irn: "IRN", iran: "IRN", "team melli": "IRN", "ir iran": "IRN", "🇮🇷": "IRN",
  // Iraq
  irq: "IRQ", iraq: "IRQ", "🇮🇶": "IRQ",
  // Jordan
  jor: "JOR", jordan: "JOR", "🇯🇴": "JOR",
  // Japan
  jpn: "JPN", japan: "JPN", "samurai blue": "JPN", "🇯🇵": "JPN",
  // South Korea (Korea Republic)
  kor: "KOR", "south korea": "KOR", "s korea": "KOR", "korea republic": "KOR", "republic of korea": "KOR", korea: "KOR", "🇰🇷": "KOR",
  // Saudi Arabia
  ksa: "KSA", "saudi arabia": "KSA", "saudi": "KSA", "green falcons": "KSA", "🇸🇦": "KSA",
  // Morocco
  mar: "MAR", morocco: "MAR", maroc: "MAR", "atlas lions": "MAR", "🇲🇦": "MAR",
  // Mexico
  mex: "MEX", mexico: "MEX", "el tri": "MEX", "🇲🇽": "MEX",
  // Netherlands
  ned: "NED", netherlands: "NED", holland: "NED", nederland: "NED", "the netherlands": "NED", oranje: "NED", "🇳🇱": "NED",
  // Norway
  nor: "NOR", norway: "NOR", norge: "NOR", "🇳🇴": "NOR",
  // New Zealand
  nzl: "NZL", "new zealand": "NZL", "all whites": "NZL", "🇳🇿": "NZL",
  // Panama
  pan: "PAN", panama: "PAN", "🇵🇦": "PAN",
  // Paraguay
  par: "PAR", paraguay: "PAR", "🇵🇾": "PAR",
  // Portugal
  por: "POR", portugal: "POR", "selecao das quinas": "POR", "🇵🇹": "POR",
  // Qatar
  qat: "QAT", qatar: "QAT", "🇶🇦": "QAT",
  // South Africa
  rsa: "RSA", "south africa": "RSA", bafana: "RSA", "bafana bafana": "RSA", "🇿🇦": "RSA",
  // Scotland
  sco: "SCO", scotland: "SCO", "tartan army": "SCO", "🏴󠁧󠁢󠁳󠁣󠁴󠁿": "SCO",
  // Senegal
  sen: "SEN", senegal: "SEN", "teranga lions": "SEN", "🇸🇳": "SEN",
  // Switzerland
  sui: "SUI", switzerland: "SUI", suisse: "SUI", schweiz: "SUI", swiss: "SUI", "🇨🇭": "SUI",
  // Sweden
  swe: "SWE", sweden: "SWE", sverige: "SWE", "blagult": "SWE", "🇸🇪": "SWE",
  // Tunisia
  tun: "TUN", tunisia: "TUN", "carthage eagles": "TUN", "🇹🇳": "TUN",
  // Turkey / Türkiye
  tur: "TUR", turkey: "TUR", turkiye: "TUR", "türkiye": "TUR", "🇹🇷": "TUR",
  // Uruguay
  uru: "URU", uruguay: "URU", "la celeste": "URU", "🇺🇾": "URU",
  // USA
  usa: "USA", "united states": "USA", "united states of america": "USA", "us": "USA", "the us": "USA", america: "USA", american: "USA", usmnt: "USA", "🇺🇸": "USA",
  // Uzbekistan
  uzb: "UZB", uzbekistan: "UZB", "🇺🇿": "UZB",
  // Algeria
  alg: "ALG", algeria: "ALG", "fennec foxes": "ALG", "les fennecs": "ALG", "🇩🇿": "ALG",
};

/**
 * Strip diacritics, lowercase, collapse whitespace, strip punctuation
 * except dashes (we keep them so "Bosnia-Herzegovina" can match
 * "Bosnia and Herzegovina" via the alias table).
 */
function canonicalise(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s\-&🇦-🇿🏴]/giu, "")
    .replace(/\s+/g, " ")
    .replace(/\s*&\s*/g, " and ")
    .replace(/-/g, " ")
    .trim();
}

/**
 * Normalise a raw team name from a source platform to our 3-letter
 * code. Returns null if the alias is unknown (caller flags as
 * 'team-unmappable').
 */
export function normaliseTeamName(raw: string): TeamCode | null {
  if (!raw) return null;
  const key = canonicalise(raw);
  if (!key) return null;
  if (key in ALIASES) return ALIASES[key];
  // Try also without spaces in case the source emits "newzealand".
  const compact = key.replace(/\s+/g, "");
  if (compact in ALIASES) return ALIASES[compact];
  return null;
}

/**
 * Convenience: normalise both sides of a match and the predicted
 * winner in one call. Returns null on any individual unmappable.
 */
export function normaliseMatchTeams(args: {
  homeTeamRaw: string;
  awayTeamRaw: string;
  predictedWinnerRaw: string | "draw";
}):
  | {
      home: TeamCode;
      away: TeamCode;
      outcome: "home_win" | "draw" | "away_win";
    }
  | null {
  const home = normaliseTeamName(args.homeTeamRaw);
  const away = normaliseTeamName(args.awayTeamRaw);
  if (!home || !away) return null;
  if (args.predictedWinnerRaw === "draw") {
    return { home, away, outcome: "draw" };
  }
  const winner = normaliseTeamName(args.predictedWinnerRaw);
  if (!winner) return null;
  if (winner === home) return { home, away, outcome: "home_win" };
  if (winner === away) return { home, away, outcome: "away_win" };
  return null;
}

export { TEAM_CODES };
