/**
 * PM2 process descriptor for Tournamental Sage.
 *
 * Sage does one decision pass per invocation and exits. PM2's `cron_restart`
 * re-launches the process at the top of every sixth hour (00:00, 06:00,
 * 12:00, 18:00 UTC). `autorestart: false` makes sure PM2 does not respawn
 * us in between cron ticks if we exit early (e.g. nothing to do).
 *
 * Run from this directory:
 *   pnpm --filter @tournamental/sage build
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * Logs land in ./logs/. PM2 rotates them via pm2-logrotate (already
 * configured on the dev box).
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §9.
 * Plan: docs/superpowers/plans/2026-06-07-bot-arena-phase-1.md Task 20.
 */

module.exports = {
  apps: [
    {
      name: "tournamental-sage",
      cwd: __dirname,
      script: "dist/index.js",
      interpreter: "node",
      node_args: ["--enable-source-maps"],
      cron_restart: "0 */6 * * *",
      autorestart: false,
      max_memory_restart: "256M",
      kill_timeout: 10_000,
      out_file: "./logs/sage.out.log",
      error_file: "./logs/sage.err.log",
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: "production",
        // Secrets are loaded from .env via the operator's shell or PM2
        // module pm2-env. Do not check secrets in here.
        TOURNAMENTAL_API_BASE: "https://api.tournamental.com",
        ODDS_API_BASE: "https://odds.tournamental.com",
        TOURNAMENT_ID: "fifa-wc-2026",
        SAGE_MODEL: "claude-opus-4-7",
        SAGE_MAX_PICKS: "24",
      },
    },
  ],
};
