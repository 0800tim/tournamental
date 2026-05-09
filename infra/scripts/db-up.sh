#!/usr/bin/env bash
# Bring up the VTorn dev DB stack and wait for healthchecks to pass.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_DIR="$REPO_ROOT/infra/docker"
ENV_FILE="$REPO_ROOT/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy .env.example and fill in real passwords." >&2
  exit 2
fi

# Defensive: shell env takes precedence over --env-file in Docker Compose
# (https://docs.docker.com/compose/environment-variables/). If another project
# (e.g. clawdia) exported POSTGRES_USER in this shell, compose would use it
# and Postgres would init with the wrong role. Unset the relevant vars so the
# env-file values are the only source.
unset POSTGRES_HOST POSTGRES_PORT POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD
unset DATABASE_URL REDIS_HOST REDIS_PORT REDIS_PASSWORD REDIS_URL
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

cd "$COMPOSE_DIR"
docker compose --env-file "$ENV_FILE" up -d
echo "Waiting for healthy state..."
for i in $(seq 1 60); do
  status="$(docker compose --env-file "$ENV_FILE" ps --format json | python3 -c '
import json, sys
states = []
for line in sys.stdin:
  line = line.strip()
  if not line: continue
  try:
    d = json.loads(line)
  except Exception:
    continue
  states.append((d.get("Name"), d.get("Health") or d.get("State")))
print("|".join(f"{n}={s}" for n, s in states))
')"
  echo "[$i] $status"
  if echo "$status" | grep -qE "vtorn-postgres=(healthy|running)" && echo "$status" | grep -qE "vtorn-redis=(healthy|running)"; then
    if echo "$status" | grep -q "healthy"; then
      echo "ready."
      docker compose --env-file "$ENV_FILE" ps
      exit 0
    fi
  fi
  sleep 2
done
echo "Timed out waiting for healthchecks." >&2
docker compose --env-file "$ENV_FILE" ps
exit 1
