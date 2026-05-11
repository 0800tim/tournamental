/**
 * Manifest of public Fastify services that surface on the API docs portal
 * mounted at `/api`. The aggregator at
 * `apps/marketing/scripts/build-openapi-index.mjs` reads this list and, for
 * each entry, attempts to fetch the live `/openapi.json` (or `/docs/json`),
 * falling back to the committed snapshot at
 * `docs/api/<snapshotName>.openapi.json` when the service is offline.
 *
 * Add a new public service here. Do not include admin-only or internal
 * services (auth-sms, dm-otp, dm-poll-forwarder, push-notifications,
 * social-publisher, crm-bridge), those are intentionally hidden from the
 * public portal, even though they all dump an OpenAPI snapshot for
 * internal tooling.
 *
 * Service tunnel URLs are sourced from docs/22-deployment-and-tunnels.md.
 * The portal prefers prod hostnames (api.tournamental.com etc.) when the
 * NODE_ENV is production, and falls back to the dev tunnel otherwise.
 */
export interface ApiService {
  /** Stable slug used as the OpenAPI `tag` and the deep-link route. */
  slug: string;
  /** Display name on the portal. */
  name: string;
  /** Workspace package name (e.g. `@vtorn/game`). */
  pkg: string;
  /** Short, one-line description shown on the index page. */
  description: string;
  /**
   * Auth model summary, surfaced in the portal sidebar so an integrator
   * can tell at a glance whether the endpoints need a token.
   */
  auth: "public" | "bearer" | "magic-link" | "admin-token" | "mixed";
  /** GitHub source path, relative to the repo root, for the deep-link header. */
  source: string;
  /**
   * Snapshot file basename in `docs/api/`. The aggregator reads
   * `docs/api/<snapshotName>.openapi.json` when the live URL is offline.
   */
  snapshotName: string;
  /**
   * Public URL the aggregator hits at build time. The path
   * `/docs/json` is the @fastify/swagger-ui canonical JSON endpoint;
   * the aggregator also tries `/openapi.json` as a polite fallback.
   * Override via the `<SLUG>_API_URL` env var at build time.
   */
  url: { dev: string; prod: string };
}

export const API_SERVICES: ApiService[] = [
  {
    slug: "game",
    name: "Game",
    pkg: "@vtorn/game",
    description:
      "Bracket submission, match-result settlement, leaderboards, syndicates, and Verified-Pundit endpoints.",
    auth: "mixed",
    source: "apps/game",
    snapshotName: "game",
    url: {
      dev: "https://vtorn-game.aiva.nz",
      prod: "https://game.tournamental.com",
    },
  },
  {
    slug: "identity",
    name: "Identity",
    pkg: "@vtorn/identity",
    description:
      "Authentication, humanness score, and account-link endpoints used across the platform.",
    auth: "mixed",
    source: "apps/identity",
    snapshotName: "identity",
    url: {
      dev: "https://vtorn-identity.aiva.nz",
      prod: "https://identity.tournamental.com",
    },
  },
  {
    slug: "vstamp",
    name: "VStamp",
    pkg: "@vtorn/vstamp",
    description:
      "On-chain Merkle-signed prediction receipts. Stamp a bracket, verify a stamp.",
    auth: "public",
    source: "apps/vstamp",
    snapshotName: "vstamp",
    url: {
      dev: "https://vtorn-vstamp.aiva.nz",
      prod: "https://vstamp.tournamental.com",
    },
  },
  {
    slug: "affiliate-router",
    name: "Affiliate Router",
    pkg: "@vtorn/affiliate-router",
    description:
      "Geo-gated affiliate-code resolution and click audit for Polymarket, sportsbook, and pay-TV partners.",
    auth: "public",
    source: "apps/affiliate-router",
    snapshotName: "affiliate-router",
    url: {
      dev: "https://vtorn-aff.aiva.nz",
      prod: "https://aff.tournamental.com",
    },
  },
  {
    slug: "drips-bridge",
    name: "Drips Bridge",
    pkg: "@vtorn/drips-bridge",
    description:
      "Bridge to the Drips Network for contributor revenue splits.",
    auth: "public",
    source: "apps/drips-bridge",
    snapshotName: "drips-bridge",
    url: {
      dev: "https://vtorn-drips.aiva.nz",
      prod: "https://drips.tournamental.com",
    },
  },
  {
    slug: "news-aggregator",
    name: "News Aggregator",
    pkg: "@vtorn/news-aggregator",
    description:
      "Public RSS-poller endpoints surfacing the BBC, Guardian, ESPN, Marca, FIFA, and Goal feeds.",
    auth: "public",
    source: "apps/news-aggregator",
    snapshotName: "news-aggregator",
    url: {
      dev: "https://vtorn-news.aiva.nz",
      prod: "https://news.tournamental.com",
    },
  },
  {
    slug: "clip-pipeline",
    name: "Clip Pipeline",
    pkg: "@vtorn/clip-pipeline",
    description: "Public read endpoints for clip render status and outputs.",
    auth: "public",
    source: "apps/clip-pipeline",
    snapshotName: "clip-pipeline",
    url: {
      dev: "https://vtorn-clip.aiva.nz",
      prod: "https://clip.tournamental.com",
    },
  },
  {
    slug: "odds-ingest",
    name: "Odds Ingest",
    pkg: "@tournamental/odds-ingest",
    description:
      "Public odds-snapshot endpoints sourced from Polymarket and The Odds API.",
    auth: "public",
    source: "apps/odds-ingest",
    snapshotName: "odds-ingest",
    url: {
      dev: "https://vtorn-odds.aiva.nz",
      prod: "https://odds.tournamental.com",
    },
  },
  {
    slug: "wc2026-data",
    name: "WC2026 Data",
    pkg: "@vtorn/wc2026-data-scripts",
    description:
      "Public read-only fixture and team data for the FIFA World Cup 2026 tournament.",
    auth: "public",
    source: "apps/wc2026-data",
    snapshotName: "wc2026-data",
    url: {
      dev: "https://vtorn-wc2026.aiva.nz",
      prod: "https://wc2026.tournamental.com",
    },
  },
  {
    slug: "api",
    name: "Umbrella API",
    pkg: "@vtorn/api",
    description:
      "The umbrella tournamental.com API surface, health, version, and cross-service composites.",
    auth: "mixed",
    source: "apps/api",
    snapshotName: "api",
    url: {
      dev: "https://vtorn-api.aiva.nz",
      prod: "https://api.tournamental.com",
    },
  },
];

/**
 * Services intentionally skipped from the public portal. Listed here so the
 * portal can render an explicit "not on the public docs" notice rather than
 * a confused 404, and so contributors can see at a glance which services
 * are internal.
 */
export const SKIPPED_SERVICES: { pkg: string; reason: string }[] = [
  { pkg: "@vtorn/auth-sms", reason: "Private OTP, admin-only." },
  { pkg: "@vtorn/dm-otp", reason: "Internal Discord-DM OTP flow." },
  {
    pkg: "@vtorn/dm-poll-forwarder",
    reason: "Internal Discord poll forwarder.",
  },
  {
    pkg: "@vtorn/push-notifications",
    reason: "Internal cron + push fan-out, no public surface.",
  },
  {
    pkg: "@vtorn/social-publisher",
    reason: "Admin-only scheduler for Twitter/Telegram posts.",
  },
  { pkg: "@vtorn/crm-bridge", reason: "Internal GoHighLevel relay." },
];

/**
 * Returns the URL the aggregator should hit for a given service. Honours
 * the `<SLUG>_API_URL` env override (the convention used across the repo
 * for swapping in a local override), then falls back to the dev tunnel.
 */
export function resolveServiceUrl(
  s: ApiService,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env[envKeyForSlug(s.slug)];
  if (override && override.length > 0) return override.replace(/\/$/, "");
  if (env.NODE_ENV === "production") return s.url.prod;
  return s.url.dev;
}

function envKeyForSlug(slug: string): string {
  // affiliate-router -> AFFILIATE_ROUTER_API_URL
  return `${slug.replace(/-/g, "_").toUpperCase()}_API_URL`;
}
