#!/usr/bin/env bash
# PM2 entrypoint for vtorn-auth-sms.
#
# Loads .env via Node's --env-file flag (Node 20+) and runs the service
# through tsx so workspace TypeScript packages resolve at runtime
# without a separate build step.
#
# Usage:
#   pm2 start ./start.sh --name vtorn-auth-sms \
#     --cwd /home/clawdbot/clawdia/projects/vtorn/apps/auth-sms
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Source .env into the current shell so pm2's logs see the values and
# child processes (notably the Aiva SMS client) inherit them.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . .env
  set +a
fi

exec npx tsx src/index.ts
