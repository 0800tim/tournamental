/**
 * PM2 process descriptor. Run from this directory:
 *   pm2 start pm2-ecosystem.config.cjs
 *   pm2 save
 */
module.exports = {
  apps: [
    {
      name: "odds-ingest",
      cwd: __dirname,
      script: "dist/index.js",
      interpreter: "node",
      node_args: ["--enable-source-maps"],
      env: {
        NODE_ENV: "production",
        ODDS_INGEST_PORT: "3340",
        // 3340 = the same-origin /api/odds proxy port (dev + prod). NOT 3341:
        // odds.tournamental.com routes to 3341 and is consumed browser-direct
        // by the OLD prod build, whose client cannot parse the new wire shape
        // (renders NaN). Keep it off 3341 until prod web ships the client fix.
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
