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
        ODDS_INGEST_BIND: "0.0.0.0",
        ODDS_INGEST_DB_PATH: "./data/odds-ingest.sqlite",
        LOG_LEVEL: "info",
      },
      max_memory_restart: "512M",
      autorestart: true,
      restart_delay: 5_000,
      kill_timeout: 10_000,
    },
  ],
};
