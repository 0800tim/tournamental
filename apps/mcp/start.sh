#!/usr/bin/env bash
# PM2 entrypoint for vtorn-mcp.
#
# Runs the prebuilt MCP HTTP server from dist/. Reads env from .env so
# log lines surface the actual values and child code (game-client
# fetches, auth-sms calls) inherits them.
#
# Usage:
#   pm2 start ./start.sh --name vtorn-mcp \
#     --cwd /home/clawdbot/clawdia/projects/vtorn/apps/mcp
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Source .env so MCP_PORT / TOURNAMENTAL_ADMIN_* / GAME_BASE_URL etc.
# reach the Node process via process.env. Matches the pattern used by
# vtorn-auth-sms and vtorn-tournament-bot.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . .env
  set +a
fi

# Ensure the data dir exists for the audit log path declared in .env.
mkdir -p "$DIR/data"

exec node dist/bin/cli.js --mode=http
