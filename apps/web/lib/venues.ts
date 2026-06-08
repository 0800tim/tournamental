/**
 * Venue metadata lookup for the 16 FIFA World Cup 2026 host stadiums.
 *
 * The fixture JSON only carries the venue NAME and host country code;
 * everything user-facing (city, country label, IANA timezone for local
 * kickoff display) is layered on here. Keeping it in apps/web/lib means
 * @tournamental/bracket-engine stays a pure data package.
 *
 * Timezone strings are IANA zone IDs so Intl.DateTimeFormat resolves
 * DST correctly for the June-July 2026 window.
 */

export interface VenueInfo {
  /** As it appears in fixtures JSON. */
  readonly venue: string;
  /** Two-letter host country code, mirrors `fixture.host`. */
  readonly host: "MX" | "CA" | "US";
  /** City name to show under the row. */
  readonly city: string;
  /** Full country name for the row strip. */
  readonly country: string;
  /** IANA timezone for the venue's local kickoff display. */
  readonly timezone: string;
}

export const VENUES: Readonly<Record<string, VenueInfo>> = {
  "Estadio Azteca":          { venue: "Estadio Azteca",          host: "MX", city: "Mexico City",     country: "Mexico", timezone: "America/Mexico_City" },
  "Estadio Akron":           { venue: "Estadio Akron",           host: "MX", city: "Guadalajara",     country: "Mexico", timezone: "America/Mexico_City" },
  "Estadio BBVA":            { venue: "Estadio BBVA",            host: "MX", city: "Monterrey",       country: "Mexico", timezone: "America/Monterrey" },
  "BMO Field":               { venue: "BMO Field",               host: "CA", city: "Toronto",         country: "Canada", timezone: "America/Toronto" },
  "BC Place":                { venue: "BC Place",                host: "CA", city: "Vancouver",       country: "Canada", timezone: "America/Vancouver" },
  "AT&T Stadium":            { venue: "AT&T Stadium",            host: "US", city: "Arlington, TX",   country: "USA",    timezone: "America/Chicago" },
  "Arrowhead Stadium":       { venue: "Arrowhead Stadium",       host: "US", city: "Kansas City, MO", country: "USA",    timezone: "America/Chicago" },
  "NRG Stadium":             { venue: "NRG Stadium",             host: "US", city: "Houston, TX",     country: "USA",    timezone: "America/Chicago" },
  "SoFi Stadium":            { venue: "SoFi Stadium",            host: "US", city: "Los Angeles, CA", country: "USA",    timezone: "America/Los_Angeles" },
  "Levi's Stadium":          { venue: "Levi's Stadium",          host: "US", city: "Santa Clara, CA", country: "USA",    timezone: "America/Los_Angeles" },
  "Lumen Field":             { venue: "Lumen Field",             host: "US", city: "Seattle, WA",     country: "USA",    timezone: "America/Los_Angeles" },
  "Hard Rock Stadium":       { venue: "Hard Rock Stadium",       host: "US", city: "Miami Gardens, FL", country: "USA",  timezone: "America/New_York" },
  "Lincoln Financial Field": { venue: "Lincoln Financial Field", host: "US", city: "Philadelphia, PA", country: "USA",   timezone: "America/New_York" },
  "MetLife Stadium":         { venue: "MetLife Stadium",         host: "US", city: "East Rutherford, NJ", country: "USA", timezone: "America/New_York" },
  "Gillette Stadium":        { venue: "Gillette Stadium",        host: "US", city: "Foxborough, MA",  country: "USA",    timezone: "America/New_York" },
  "Mercedes-Benz Stadium":   { venue: "Mercedes-Benz Stadium",   host: "US", city: "Atlanta, GA",     country: "USA",    timezone: "America/New_York" },
};

export function venueInfo(venue: string | null | undefined): VenueInfo | undefined {
  if (!venue) return undefined;
  return VENUES[venue];
}

const HOST_FLAGS: Record<"MX" | "CA" | "US", string> = {
  MX: "🇲🇽",
  CA: "🇨🇦",
  US: "🇺🇸",
};

export function hostFlag(host: "MX" | "CA" | "US" | string): string {
  if (host === "MX" || host === "CA" || host === "US") return HOST_FLAGS[host];
  return "";
}
