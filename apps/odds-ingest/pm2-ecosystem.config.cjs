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
        ODDS_INGEST_PORT: "3341",
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
