/**
 * FIFA three-letter team code → ISO 3166-1 alpha-2 → Unicode flag emoji.
 *
 * Used by the match-replay HUD to render a small flag next to the team
 * short name. The full FIFA list is too long to embed exhaustively; we
 * cover the 32 WC 2022 entrants + a handful of strong qualifiers for
 * 2026 so the AR-FR demo and the bracket previews both work without a
 * remote lookup.
 *
 * Returns `null` for codes we don't recognise — the caller should
 * gracefully fall back to the short name only.
 */

const FIFA_TO_ISO2: Record<string, string> = {
  // 2022 World Cup squads
  ARG: "AR",
  AUS: "AU",
  BEL: "BE",
  BRA: "BR",
  CMR: "CM",
  CAN: "CA",
  CRC: "CR",
  CRO: "HR",
  DEN: "DK",
  ECU: "EC",
  ENG: "GB", // close enough on most platforms
  FRA: "FR",
  GER: "DE",
  GHA: "GH",
  IRN: "IR",
  JPN: "JP",
  KOR: "KR",
  KSA: "SA",
  MAR: "MA",
  MEX: "MX",
  NED: "NL",
  POL: "PL",
  POR: "PT",
  QAT: "QA",
  SEN: "SN",
  SRB: "RS",
  ESP: "ES",
  SUI: "CH",
  TUN: "TN",
  URU: "UY",
  USA: "US",
  WAL: "GB",
  // Other strong qualifiers for 2026 / common bracket teams
  COL: "CO",
  ITA: "IT",
  TUR: "TR",
  EGY: "EG",
  NGA: "NG",
  ALG: "DZ",
  CHI: "CL",
  PAR: "PY",
  PER: "PE",
  VEN: "VE",
  BOL: "BO",
  RUS: "RU",
  UKR: "UA",
  CZE: "CZ",
  SVK: "SK",
  SLO: "SI",
  AUT: "AT",
  HUN: "HU",
  GRE: "GR",
  ROU: "RO",
  BUL: "BG",
  IRL: "IE",
  NOR: "NO",
  SWE: "SE",
  FIN: "FI",
  ISL: "IS",
  SCO: "GB",
  NIR: "GB",
  NZL: "NZ",
};

/**
 * Convert an ISO 3166-1 alpha-2 code to its regional-indicator flag.
 * Returns `null` for invalid codes.
 */
export function iso2ToFlagEmoji(iso2: string): string | null {
  if (iso2.length !== 2) return null;
  const A = iso2.toUpperCase().charCodeAt(0);
  const B = iso2.toUpperCase().charCodeAt(1);
  if (A < 65 || A > 90 || B < 65 || B > 90) return null;
  // Regional Indicator Symbol letters live at U+1F1E6..U+1F1FF
  return (
    String.fromCodePoint(0x1f1e6 + (A - 65)) +
    String.fromCodePoint(0x1f1e6 + (B - 65))
  );
}

export function fifaCodeToFlagEmoji(code: string | undefined): string | null {
  if (!code) return null;
  const iso = FIFA_TO_ISO2[code.toUpperCase()];
  if (!iso) return null;
  return iso2ToFlagEmoji(iso);
}
