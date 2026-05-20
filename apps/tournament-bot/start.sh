#!/usr/bin/env bash
# PM2 entrypoint for vtorn-tournament-bot.
#
# Loads .env into the shell so child processes (the Aiva client, the
# auth-sms internal call) inherit them, then runs the service through
# tsx so workspace TypeScript packages resolve at runtime.
#
# Usage:
#   pm2 start ./start.sh --name vtorn-tournament-bot \
#     --cwd /home/clawdbot/clawdia/projects/vtorn/apps/tournament-bot
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . .env
  set +a
fi

exec npx tsx src/index.ts
