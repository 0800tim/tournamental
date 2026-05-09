/**
 * Process config. Pure function of process.env so tests can reset it
 * by mutating env then calling loadConfig() again.
 */

export interface Config {
  port: number;
  bind: string;
  dbPath: string;
  logLevel: string;
  polymarket: {
    enabled: boolean;
    gammaUrl: string;
    clobUrl: string;
    tagSlugs: string[];
    pollGammaMs: number;
    pollClobMs: number;
  };
  theOddsApi: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string | null;
    pollMs: number;
  };
  mock: {
    enabled: boolean;
  };
}

function asBool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined) return dflt;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

function asInt(v: string | undefined, dflt: number): number {
  if (v === undefined || v === "") return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: asInt(env.ODDS_INGEST_PORT, 3341),
    bind: env.ODDS_INGEST_BIND ?? "0.0.0.0",
    dbPath: env.ODDS_INGEST_DB_PATH ?? "./data/odds-ingest.sqlite",
    logLevel: env.LOG_LEVEL ?? "info",
    polymarket: {
      enabled: asBool(env.SOURCE_POLYMARKET_ENABLED, true),
      gammaUrl: env.POLYMARKET_GAMMA_URL ?? "https://gamma-api.polymarket.com",
      clobUrl: env.POLYMARKET_CLOB_URL ?? "https://clob.polymarket.com",
      tagSlugs: (env.POLYMARKET_TAG_SLUGS ?? "fifa-world-cup,fifa-2026,world-cup-2026")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      pollGammaMs: asInt(env.POLL_GAMMA_MS, 5 * 60_000),
      pollClobMs: asInt(env.POLL_CLOB_MS, 30_000),
    },
    theOddsApi: {
      enabled: asBool(env.SOURCE_THE_ODDS_API_ENABLED, true),
      baseUrl: env.THE_ODDS_API_BASE ?? "https://api.the-odds-api.com/v4",
      apiKey: (env.THE_ODDS_API_KEY ?? "").trim() || null,
      pollMs: asInt(env.POLL_THE_ODDS_API_MS, 60 * 60_000),
    },
    mock: {
      enabled: asBool(env.SOURCE_MOCK_ENABLED, true),
    },
  };
}
