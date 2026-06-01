/**
 * Test-only Fetcher implementation. Lives in its own file so parser
 * unit tests can import it without dragging in `fetcher.ts`'s lazy
 * Playwright import (which Vite's transform stage can't statically
 * resolve and warns on).
 *
 * Production code never imports this; only the parser test suites do.
 */

import type { Fetcher } from "./types";

/**
 * Returns canned HTML for any URL whose prefix matches the supplied
 * map. Used by parser unit tests so we never hit the network.
 */
export function staticFetcher(byUrlPrefix: Record<string, string>): Fetcher {
  return {
    async fetch({ url }) {
      for (const [prefix, html] of Object.entries(byUrlPrefix)) {
        if (url.startsWith(prefix)) {
          return { ok: true, html, status: 200, finalUrl: url };
        }
      }
      return { ok: false, status: 404, error: "no-stub" };
    },
  };
}
