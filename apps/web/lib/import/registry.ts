/**
 * Parser registry. Maps the wire `source` discriminator to the
 * concrete `BracketParser` implementation.
 *
 * Each parser module default-exports a `BracketParser` instance.
 * Lazy imports so a build-break in one parser doesn't crater the
 * whole API route; we surface that as a per-source failure at
 * preview time instead.
 *
 * The 'screenshot-ai' source goes through a different code path
 * (apps/web/lib/import/parsers/screenshot.ts::parseScreenshot) and
 * isn't in this registry.
 */

import type { BracketParser, ImportSource } from "./types";

const REGISTRY: Partial<Record<ImportSource, () => Promise<BracketParser>>> = {
  telegraph: async () => (await import("./parsers/telegraph")).telegraphParser,
  espn: async () => (await import("./parsers/espn")).espnParser,
  bbc: async () => (await import("./parsers/bbc")).bbcParser,
  fifa: async () => (await import("./parsers/fifa")).fifaParser,
};

export async function loadParser(
  source: ImportSource,
): Promise<BracketParser | null> {
  const loader = REGISTRY[source];
  if (!loader) return null;
  try {
    return await loader();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[import/registry] couldn't load parser for ${source}:`, err);
    return null;
  }
}

/**
 * List of sources the wizard can offer. Excludes 'screenshot-ai'
 * which is the fallback path, surfaced separately in the UI.
 */
export const SUPPORTED_URL_SOURCES: ReadonlyArray<ImportSource> = [
  "telegraph",
  "bbc",
  "fifa",
  "espn",
];
