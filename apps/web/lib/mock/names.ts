/**
 * A small, hand-picked static list of plausible international
 * football-fan names + country codes used by the mock leaderboard
 * generator and the bot-builder's persona picker.
 *
 * Goals:
 *  - Multinational + inclusive, spread across the WC 2026 field.
 *  - Recognisable as football-watching nations (ARG, BRA, FRA, ENG, ...).
 *  - Deterministic order, the mock generator slices and shuffles
 *    using a seeded RNG, never `Math.random()`, so leaderboards stay
 *    visually stable between renders and snapshots.
 *  - No real public-figure names. These are common given-name +
 *    surname combinations.
 *
 * Tim 2026-06-07: the list now uses FIFA country codes (matching the
 * bracket-engine fixture data) and only includes nations actually
 * competing in the 2026 World Cup. Italy, Ireland, Denmark, Nigeria,
 * and Costa Rica were dropped this edition; they'll come back if/when
 * they qualify. The previous edition included them as ISO-3166 codes,
 * which leaked into the /run/bots persona list as "Italy in my bot
 * list" even though Italy isn't in the 2026 field.
 */

export interface MockName {
  readonly name: string;
  readonly handle: string;
  /** FIFA country code (matches `@tournamental/bracket-engine` Team.id). */
  readonly country: string;
  readonly flag: string; // emoji
}

export const MOCK_NAMES: readonly MockName[] = [
  // Argentina, 5
  { name: "Diego Reyes", handle: "@diego_r", country: "ARG", flag: "🇦🇷" },
  { name: "Sofia Marchetti", handle: "@sofi_m", country: "ARG", flag: "🇦🇷" },
  { name: "Mateo Ibarra", handle: "@mateo_i", country: "ARG", flag: "🇦🇷" },
  { name: "Lucia Romero", handle: "@lucia_r", country: "ARG", flag: "🇦🇷" },
  { name: "Tomas Vega", handle: "@tomas_v", country: "ARG", flag: "🇦🇷" },

  // Brazil, 4
  { name: "Bruno Almeida", handle: "@bruno_a", country: "BRA", flag: "🇧🇷" },
  { name: "Camila Souza", handle: "@cami_s", country: "BRA", flag: "🇧🇷" },
  { name: "Rafael Oliveira", handle: "@rafa_o", country: "BRA", flag: "🇧🇷" },
  { name: "Larissa Pinto", handle: "@lari_p", country: "BRA", flag: "🇧🇷" },

  // France, 4
  { name: "Antoine Dubois", handle: "@antoine_d", country: "FRA", flag: "🇫🇷" },
  { name: "Camille Laurent", handle: "@camille_l", country: "FRA", flag: "🇫🇷" },
  { name: "Lucas Moreau", handle: "@lucas_m", country: "FRA", flag: "🇫🇷" },
  { name: "Élodie Bernard", handle: "@elodie_b", country: "FRA", flag: "🇫🇷" },

  // England, 3
  { name: "Liam Walsh", handle: "@liam_w", country: "ENG", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { name: "Eleanor Briggs", handle: "@ellie_b", country: "ENG", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { name: "Harry Whitman", handle: "@harry_w", country: "ENG", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },

  // Spain, 3
  { name: "Pablo Castillo", handle: "@pablo_c", country: "ESP", flag: "🇪🇸" },
  { name: "Maria Vidal", handle: "@maria_v", country: "ESP", flag: "🇪🇸" },
  { name: "Javier Ortega", handle: "@javi_o", country: "ESP", flag: "🇪🇸" },

  // Germany, 3 (FIFA code GER, not ISO DEU)
  { name: "Max Hoffmann", handle: "@max_h", country: "GER", flag: "🇩🇪" },
  { name: "Lena Schmidt", handle: "@lena_s", country: "GER", flag: "🇩🇪" },
  { name: "Felix Becker", handle: "@felix_b", country: "GER", flag: "🇩🇪" },

  // Portugal, 3 (FIFA code POR, not ISO PRT)
  { name: "Ricardo Sousa", handle: "@rica_s", country: "POR", flag: "🇵🇹" },
  { name: "Beatriz Lopes", handle: "@bia_l", country: "POR", flag: "🇵🇹" },
  { name: "Tiago Ferreira", handle: "@tiago_f", country: "POR", flag: "🇵🇹" },

  // Netherlands, 2 (FIFA code NED, not ISO NLD)
  { name: "Sander Bakker", handle: "@sander_b", country: "NED", flag: "🇳🇱" },
  { name: "Anouk de Vries", handle: "@anouk_v", country: "NED", flag: "🇳🇱" },

  // Japan, 2
  { name: "Hiroshi Tanaka", handle: "@hiro_t", country: "JPN", flag: "🇯🇵" },
  { name: "Akari Nakamura", handle: "@akari_n", country: "JPN", flag: "🇯🇵" },

  // Mexico, 2
  { name: "Carlos Mendoza", handle: "@carlos_m", country: "MEX", flag: "🇲🇽" },
  { name: "Valeria Cruz", handle: "@vale_c", country: "MEX", flag: "🇲🇽" },

  // United States, 2
  { name: "Jordan Hayes", handle: "@jordan_h", country: "USA", flag: "🇺🇸" },
  { name: "Aaliyah Khan", handle: "@aaliyah_k", country: "USA", flag: "🇺🇸" },

  // Croatia, 2 (new for the bot pool; CRO is in WC2026)
  { name: "Ivan Kovac", handle: "@ivan_k", country: "CRO", flag: "🇭🇷" },
  { name: "Petra Maric", handle: "@petra_m", country: "CRO", flag: "🇭🇷" },

  // Switzerland, 2 (SUI is in WC2026)
  { name: "Mathias Keller", handle: "@mat_k", country: "SUI", flag: "🇨🇭" },
  { name: "Léa Ammann", handle: "@lea_a", country: "SUI", flag: "🇨🇭" },

  // Norway, 2 (NOR is in WC2026)
  { name: "Sondre Berg", handle: "@sondre_b", country: "NOR", flag: "🇳🇴" },
  { name: "Ingrid Solberg", handle: "@ingrid_s", country: "NOR", flag: "🇳🇴" },

  // Singletons across the WC2026 field, alphabetical by FIFA code
  { name: "Min-jun Park", handle: "@minjun_p", country: "KOR", flag: "🇰🇷" },
  { name: "Faisal Al-Harbi", handle: "@faisal_h", country: "KSA", flag: "🇸🇦" },
  { name: "Khalid Benali", handle: "@khalid_b", country: "MAR", flag: "🇲🇦" },
  { name: "Omar El-Sayed", handle: "@omar_e", country: "EGY", flag: "🇪🇬" },
  { name: "Jack Patterson", handle: "@jack_p", country: "AUS", flag: "🇦🇺" },
  { name: "Sarah McKenzie", handle: "@sarah_m", country: "CAN", flag: "🇨🇦" },
  { name: "Aliou Diop", handle: "@aliou_d", country: "SEN", flag: "🇸🇳" },
  { name: "Reza Bahari", handle: "@reza_b", country: "IRN", flag: "🇮🇷" },
  { name: "Nadia Hassan", handle: "@nadia_h", country: "TUN", flag: "🇹🇳" },
  { name: "Sebastián Carrera", handle: "@seba_c", country: "ECU", flag: "🇪🇨" },
  { name: "Kwame Owusu", handle: "@kwame_o", country: "GHA", flag: "🇬🇭" },
  { name: "Federico Núñez", handle: "@fede_n", country: "URU", flag: "🇺🇾" },
  { name: "Pelle Andersson", handle: "@pelle_a", country: "SWE", flag: "🇸🇪" },
  { name: "Emre Yilmaz", handle: "@emre_y", country: "TUR", flag: "🇹🇷" },
  { name: "Tama Brown", handle: "@tama_b", country: "NZL", flag: "🇳🇿" },
];

/**
 * Country code -> emoji map for flag rendering elsewhere.
 *
 * Codes are FIFA-style (GER/NED/POR/URU/KSA), matching the
 * bracket-engine fixture data. If a caller still passes a legacy
 * ISO-3166 alpha-3 code (DEU/NLD/PRT/URY/SAU), it won't be found here
 * and callers should fall back to a default flag glyph.
 */
export const COUNTRY_FLAGS: Readonly<Record<string, string>> = (() => {
  const map: Record<string, string> = {};
  for (const n of MOCK_NAMES) map[n.country] = n.flag;
  return map;
})();
