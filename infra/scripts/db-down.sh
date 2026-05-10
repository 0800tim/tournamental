#!/usr/bin/env bash
# Stop the Tournamental dev DB stack. Volumes survive so data persists.
# Pass --nuke to also delete volumes (DESTROYS ALL DATA).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_DIR="$REPO_ROOT/infra/docker"
ENV_FILE="$REPO_ROOT/.env"
ENV_ARG=()
if [ -f "$ENV_FILE" ]; then
  ENV_ARG=(--env-file "$ENV_FILE")
  unset POSTGRES_HOST POSTGRES_PORT POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD
  unset DATABASE_URL REDIS_HOST REDIS_PORT REDIS_PASSWORD REDIS_URL
  set -a; source "$ENV_FILE"; set +a
fi
cd "$COMPOSE_DIR"
if [ "${1:-}" = "--nuke" ]; then
  read -r -p "This deletes vtorn-pgdata and vtorn-redisdata. Type 'yes' to continue: " ans
  [ "$ans" = "yes" ] || { echo "aborted."; exit 1; }
  docker compose "${ENV_ARG[@]}" down -v
else
  docker compose "${ENV_ARG[@]}" down
fi
