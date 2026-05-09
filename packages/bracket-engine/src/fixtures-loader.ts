/**
 * Convenience loader for the vendored 2026 WC fixtures JSON.
 *
 * The JSON file is a structural description of the tournament — it has a
 * `_meta` block documenting its source, a list of placeholder teams (real
 * teams when FIFA's draw is finalised), 8 groups of 6 with placeholder
 * fixtures, and the full knockout slot graph with declarative
 * dependencies. Swapping in real teams and real kickoff times is a JSON
 * replacement; no engine code changes.
 */

import type { Tournament } from "./tournament.js";

// Standard JSON import — relies on tsconfig `resolveJsonModule`. Works
// across Node 20+ and Next 14 webpack. Consumers of the package can
// also load the JSON themselves and pass it to a Tournament directly.
import fixtures2026 from "../data/fifa-wc-2026-fixtures.json";

export interface Fixtures2026 extends Tournament {
  readonly _meta: {
    readonly source: string;
    readonly source_url: string;
    readonly schedule_status: "placeholder" | "official";
    readonly fetched_at_utc: string;
    readonly notes: string;
  };
}

export function loadFixtures2026(): Fixtures2026 {
  return fixtures2026 as unknown as Fixtures2026;
}
