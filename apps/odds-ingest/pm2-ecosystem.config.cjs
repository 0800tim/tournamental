/**
 * PM2 process descriptor for odds-ingest.
 *
 * Kept as a standalone ecosystem so the service can be brought up
 * outside the full repo orchestrator (e.g. before any other vtorn
 * service is wired). For day-to-day deploys, prefer
 *   pnpm --filter @vtorn/cicd-tools run publish-all --env=production --apps=odds-ingest
 * which uses the same slot pattern (.deploy/config.json) and the
 * orchestrator's atomic swap (dist-staging -> dist-prod -> dist-prev).
 *
 * Script path is `dist-prod/index.js` to match the slot pattern;
 * a `dist -> dist-prod` symlink is maintained as a back-compat
 * fallback for any tooling that still expects `dist/`.
 *
 * Run from this directory:
 *   pm2 start pm2-ecosystem.config.cjs
 *   pm2 save
 */
module.exports = {
  apps: [
    {
      name: "odds-ingest",
      cwd: __dirname,
      script: "dist-prod/index.js",
      interpreter: "node",
      node_args: ["--enable-source-maps"],
      env: {
        NODE_ENV: "production",
        ODDS_INGEST_PORT: "3341",
        // 3341 = the odds.tournamental.com Cloudflare route. Prod web now ships
        // the wire-shape fix, so serving real odds here is safe (no NaN).
        ODDS_INGEST_BIND: "127.0.0.1",
        ODDS_INGEST_DB_PATH: "./data/odds-ingest.sqlite",
        LOG_LEVEL: "info",
        // Serve REAL Polymarket odds only: mock off, The Odds API off
        // (no key), Polymarket on under the live WC2026 tag.
        SOURCE_POLYMARKET_ENABLED: "true",
        SOURCE_MOCK_ENABLED: "false",
        SOURCE_THE_ODDS_API_ENABLED: "false",
        POLYMARKET_TAG_SLUGS: "fifa-world-cup",
      },
      max_memory_restart: "512M",
      autorestart: true,
      restart_delay: 5_000,
      kill_timeout: 10_000,
    },
  ],
};
