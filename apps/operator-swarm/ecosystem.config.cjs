// =============================================================================
// PM2 ecosystem for @tournamental/operator-swarm.
//
// Loads .env from this app's directory, then launches the @tournamental/bot-node
// CLI under PM2 with auto-restart, capped log files, and a heap big enough for
// the 1M-bot demo node.
//
// Run with:
//   pnpm --filter @tournamental/operator-swarm run start
//
// Inspect:
//   pm2 status tournamental-bot-node
//   pm2 logs tournamental-bot-node
//
// Persist across reboots (server admin runs this once after first start):
//   pm2 startup
//   pm2 save
// =============================================================================

const path = require("node:path");
const fs = require("node:fs");

const APP_DIR = __dirname;
const ENV_FILE = path.join(APP_DIR, ".env");

// Lightweight .env loader so PM2 picks up values without requiring dotenv at
// the wrapper layer. The bot-node itself may also read process.env directly.
const env = {};
if (fs.existsSync(ENV_FILE)) {
  const raw = fs.readFileSync(ENV_FILE, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
}

// Defaults aligned with .env.example. Operator-supplied values win.
const TOURNAMENTAL_API_BASE_URL =
  env.TOURNAMENTAL_API_BASE_URL || "https://api.tournamental.com";
const BOT_COUNT = env.BOT_COUNT || "1000000";
const STRATEGY = env.STRATEGY || "chalk";
const LOG_LEVEL = env.LOG_LEVEL || "info";
const BOT_NODE_STATS_PORT = env.BOT_NODE_STATS_PORT || "4811";
const OPERATOR_NODE_LABEL = env.OPERATOR_NODE_LABEL || "tim-1m-demo";

// Resolve credentials path with tilde expansion so the bot-node can find it.
const HOME = process.env.HOME || "/home/0800tim";
const rawCredsPath =
  env.OPERATOR_CREDENTIALS_PATH || `${HOME}/.tournamental/operator.json`;
const OPERATOR_CREDENTIALS_PATH = rawCredsPath.startsWith("~/")
  ? path.join(HOME, rawCredsPath.slice(2))
  : rawCredsPath;

const LOG_DIR = path.join(APP_DIR, "logs");
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

module.exports = {
  apps: [
    {
      name: "tournamental-bot-node",
      cwd: APP_DIR,
      script: "tournamental-bot-node",
      args: [
        "run",
        `--bots=${BOT_COUNT}`,
        `--strategy=${STRATEGY}`,
        `--stats-port=${BOT_NODE_STATS_PORT}`,
        `--credentials=${OPERATOR_CREDENTIALS_PATH}`,
        `--api-base-url=${TOURNAMENTAL_API_BASE_URL}`,
        `--label=${OPERATOR_NODE_LABEL}`,
      ],
      // pnpm hoists the bin into node_modules/.bin, which PM2 picks up via
      // the interpreter resolver. If the binary is not on PATH on the host,
      // swap to `interpreter: "pnpm"` and prepend `["exec", "tournamental-bot-node"]`.
      interpreter: "none",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      // If the node crashes more than 5 times within 10s, PM2 stops trying.
      // That window is intentional: 1M-bot startup briefly spikes RAM, and
      // we want PM2 to give up loudly rather than thrash the box.
      max_restarts: 5,
      min_uptime: "30s",
      restart_delay: 5000,
      kill_timeout: 30000,
      wait_ready: false,
      // 12 GB heap covers the 1M-bot demo with ~2 GB headroom. Drop to
      // --max-old-space-size=2048 for a 100k-bot node, or raise to 24576
      // for a 2M-bot node. node.js needs the flag, not a runtime config.
      node_args: ["--max-old-space-size=12288"],
      env: {
        NODE_ENV: "production",
        TOURNAMENTAL_API_BASE_URL,
        OPERATOR_NODE_LABEL,
        OPERATOR_CREDENTIALS_PATH,
        BOT_COUNT,
        STRATEGY,
        LOG_LEVEL,
        BOT_NODE_STATS_PORT,
      },
      out_file: path.join(LOG_DIR, "bot-node.out.log"),
      error_file: path.join(LOG_DIR, "bot-node.err.log"),
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      // Rotate via pm2-logrotate (installed once on the host:
      //   pm2 install pm2-logrotate
      //   pm2 set pm2-logrotate:max_size 100M
      //   pm2 set pm2-logrotate:retain 14
      // ). PM2 then keeps 14 days of 100 MB chunks.
    },
  ],
};
