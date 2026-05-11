/**
 * A small, hand-picked static list of plausible international
 * football-fan names + 3-letter country codes used by the mock
 * leaderboard generator.
 *
 * Goals:
 *  - Multinational + inclusive (50 names spread across 30+ countries).
 *  - Recognisable as football-watching nations (ARG, BRA, FRA, ENG, ...).
 *  - Deterministic order — the mock generator slices and shuffles
 *    using a seeded RNG, never `Math.random()`, so leaderboards stay
 *    visually stable between renders and snapshots.
 *  - No real public-figure names. These are common given-name +
 *    surname combinations.
 */

export interface MockName {
  readonly name: string;
  readonly handle: string;
  readonly country: string; // ISO-3 country code
  readonly flag: string; // emoji
}

export const MOCK_NAMES: readonly MockName[] = [
  // Argentina — 5
  { name: "Diego Reyes", handle: "@diego_r", country: "ARG", flag: "🇦🇷" },
  { name: "Sofia Marchetti", handle: "@sofi_m", country: "ARG", flag: "🇦🇷" },
  { name: "Mateo Ibarra", handle: "@mateo_i", country: "ARG", flag: "🇦🇷" },
  { name: "Lucia Romero", handle: "@lucia_r", country: "ARG", flag: "🇦🇷" },
  { name: "Tomas Vega", handle: "@tomas_v", country: "ARG", flag: "🇦🇷" },

  // Brazil — 4
  { name: "Bruno Almeida", handle: "@bruno_a", country: "BRA", flag: "🇧🇷" },
  { name: "Camila Souza", handle: "@cami_s", country: "BRA", flag: "🇧🇷" },
  { name: "Rafael Oliveira", handle: "@rafa_o", country: "BRA", flag: "🇧🇷" },
  { name: "Larissa Pinto", handle: "@lari_p", country: "BRA", flag: "🇧🇷" },

  // France — 4
  { name: "Antoine Dubois", handle: "@antoine_d", country: "FRA", flag: "🇫🇷" },
  { name: "Camille Laurent", handle: "@camille_l", country: "FRA", flag: "🇫🇷" },
  { name: "Lucas Moreau", handle: "@lucas_m", country: "FRA", flag: "🇫🇷" },
  { name: "Élodie Bernard", handle: "@elodie_b", country: "FRA", flag: "🇫🇷" },

  // England — 3
  { name: "Liam Walsh", handle: "@liam_w", country: "ENG", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { name: "Eleanor Briggs", handle: "@ellie_b", country: "ENG", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { name: "Harry Whitman", handle: "@harry_w", country: "ENG", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },

  // Spain — 3
  { name: "Pablo Castillo", handle: "@pablo_c", country: "ESP", flag: "🇪🇸" },
  { name: "Maria Vidal", handle: "@maria_v", country: "ESP", flag: "🇪🇸" },
  { name: "Javier Ortega", handle: "@javi_o", country: "ESP", flag: "🇪🇸" },

  // Germany — 3
  { name: "Max Hoffmann", handle: "@max_h", country: "DEU", flag: "🇩🇪" },
  { name: "Lena Schmidt", handle: "@lena_s", country: "DEU", flag: "🇩🇪" },
  { name: "Felix Becker", handle: "@felix_b", country: "DEU", flag: "🇩🇪" },

  // Portugal — 3
  { name: "Ricardo Sousa", handle: "@rica_s", country: "PRT", flag: "🇵🇹" },
  { name: "Beatriz Lopes", handle: "@bia_l", country: "PRT", flag: "🇵🇹" },
  { name: "Tiago Ferreira", handle: "@tiago_f", country: "PRT", flag: "🇵🇹" },

  // Netherlands — 2
  { name: "Sander Bakker", handle: "@sander_b", country: "NLD", flag: "🇳🇱" },
  { name: "Anouk de Vries", handle: "@anouk_v", country: "NLD", flag: "🇳🇱" },

  // Italy — 2
  { name: "Marco Bianchi", handle: "@marco_b", country: "ITA", flag: "🇮🇹" },
  { name: "Giulia Conti", handle: "@giulia_c", country: "ITA", flag: "🇮🇹" },

  // Japan — 2
  { name: "Hiroshi Tanaka", handle: "@hiro_t", country: "JPN", flag: "🇯🇵" },
  { name: "Akari Nakamura", handle: "@akari_n", country: "JPN", flag: "🇯🇵" },

  // Mexico — 2
  { name: "Carlos Mendoza", handle: "@carlos_m", country: "MEX", flag: "🇲🇽" },
  { name: "Valeria Cruz", handle: "@vale_c", country: "MEX", flag: "🇲🇽" },

  // United States — 2
  { name: "Jordan Hayes", handle: "@jordan_h", country: "USA", flag: "🇺🇸" },
  { name: "Aaliyah Khan", handle: "@aaliyah_k", country: "USA", flag: "🇺🇸" },

  // Singletons — 1 each, alphabetical
  { name: "Yusuf Adebayo", handle: "@yusuf_a", country: "NGA", flag: "🇳🇬" },
  { name: "Min-jun Park", handle: "@minjun_p", country: "KOR", flag: "🇰🇷" },
  { name: "Faisal Al-Harbi", handle: "@faisal_h", country: "SAU", flag: "🇸🇦" },
  { name: "Khalid Benali", handle: "@khalid_b", country: "MAR", flag: "🇲🇦" },
  { name: "Omar El-Sayed", handle: "@omar_e", country: "EGY", flag: "🇪🇬" },
  { name: "Jack Patterson", handle: "@jack_p", country: "AUS", flag: "🇦🇺" },
  { name: "Sarah McKenzie", handle: "@sarah_m", country: "CAN", flag: "🇨🇦" },
  { name: "Aliou Diop", handle: "@aliou_d", country: "SEN", flag: "🇸🇳" },
  { name: "Andrés Calderón", handle: "@andres_c", country: "CRC", flag: "🇨🇷" },
  { name: "Reza Bahari", handle: "@reza_b", country: "IRN", flag: "🇮🇷" },
  { name: "Aoife O'Sullivan", handle: "@aoife_o", country: "IRL", flag: "🇮🇪" },
  { name: "Magnus Pedersen", handle: "@magnus_p", country: "DNK", flag: "🇩🇰" },
  { name: "Nadia Hassan", handle: "@nadia_h", country: "TUN", flag: "🇹🇳" },
  { name: "Sebastián Carrera", handle: "@seba_c", country: "ECU", flag: "🇪🇨" },
  { name: "Kwame Owusu", handle: "@kwame_o", country: "GHA", flag: "🇬🇭" },
  { name: "Federico Núñez", handle: "@fede_n", country: "URY", flag: "🇺🇾" },
];

/**
 * 3-letter -> emoji map for country-flag rendering elsewhere.
 */
export const COUNTRY_FLAGS: Readonly<Record<string, string>> = (() => {
  const map: Record<string, string> = {};
  for (const n of MOCK_NAMES) map[n.country] = n.flag;
  return map;
})();
