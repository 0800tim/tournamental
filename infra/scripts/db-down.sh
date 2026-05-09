#!/usr/bin/env bash
# Stop the VTorn dev DB stack. Volumes survive so data persists.
# Pass --nuke to also delete volumes (DESTROYS ALL DATA).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/../docker" && pwd)"
cd "$COMPOSE_DIR"
if [ "${1:-}" = "--nuke" ]; then
  read -r -p "This deletes vtorn-pgdata and vtorn-redisdata. Type 'yes' to continue: " ans
  [ "$ans" = "yes" ] || { echo "aborted."; exit 1; }
  docker compose down -v
else
  docker compose down
fi
