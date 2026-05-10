/**
 * Public surface of the stats-scraper module. The CLI script
 * (`scripts/scrape-stats.ts`) imports from here so all the pieces
 * stay in one place; tests import individual sub-modules directly.
 */

export * from "./types.js";
export * from "./cache.js";
export * from "./aggregator.js";
export * as fbref from "./sources/fbref-team-form.js";
export * as wikidata from "./sources/wikidata-h2h.js";
export * as statsbomb from "./sources/statsbomb-h2h.js";
export * as apifootball from "./sources/apifootball-stats.js";
