/**
 * Provider barrel + factory.
 *
 * Selects a concrete `LiveDataProvider` implementation from the
 * `WC2026_DATA_BACKEND` environment variable. Default is `mock` so dev
 * and CI never need network access.
 *
 * Backends:
 *   - "mock"          → MockLiveDataProvider (deterministic; default)
 *   - "sportradar"    → SportRadarLiveDataProvider (Soccer Trial v4)
 *   - "apifootball"   → ApiFootballLiveDataProvider (API-Football v3)
 *
 * Each real backend reads its own env vars; see the per-provider source.
 * Throws a clear error if a real backend is selected without its key.
 */

import { ApiFootballLiveDataProvider } from "./apifootball-provider.js";
import { MockLiveDataProvider } from "./mock-provider.js";
import { SportRadarLiveDataProvider } from "./sportradar-provider.js";
import type { LiveDataProvider } from "./types.js";

export type Backend = "mock" | "sportradar" | "apifootball";

export function parseBackend(raw: string | undefined): Backend {
  switch ((raw ?? "mock").trim().toLowerCase()) {
    case "sportradar":
      return "sportradar";
    case "apifootball":
    case "api-football":
      return "apifootball";
    case "":
    case "mock":
      return "mock";
    default:
      throw new Error(
        `Unknown WC2026_DATA_BACKEND="${raw}". ` +
          `Allowed: mock | sportradar | apifootball`,
      );
  }
}

export interface ProviderFactoryOptions {
  /** Override for tests; falls back to process.env. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Override clock for deterministic tests. */
  readonly nowMs?: () => number;
}

/**
 * Build the provider selected by env. Real adapters validate their own
 * keys lazily — they construct fine but throw on the first real call if
 * the key is missing.
 */
export function buildProvider(opts: ProviderFactoryOptions = {}): LiveDataProvider {
  const env = opts.env ?? process.env;
  const backend = parseBackend(env.WC2026_DATA_BACKEND);
  switch (backend) {
    case "sportradar":
      return new SportRadarLiveDataProvider({
        apiKey: env.WC2026_DATA_API_KEY,
        baseUrl: env.WC2026_SPORTRADAR_BASE_URL,
      });
    case "apifootball":
      return new ApiFootballLiveDataProvider({
        apiKey: env.WC2026_DATA_API_KEY,
        baseUrl: env.WC2026_APIFOOTBALL_BASE_URL,
      });
    case "mock":
    default:
      return new MockLiveDataProvider({ nowMs: opts.nowMs });
  }
}

export type { LiveDataProvider } from "./types.js";
