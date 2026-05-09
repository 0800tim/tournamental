#!/usr/bin/env bash
# Bring up the VTorn dev DB stack and wait for healthchecks to pass.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/../docker" && pwd)"
cd "$COMPOSE_DIR"
docker compose up -d
echo "Waiting for healthy state..."
for i in $(seq 1 60); do
  status="$(docker compose ps --format json | python3 -c '
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
      docker compose ps
      exit 0
    fi
  fi
  sleep 2
done
echo "Timed out waiting for healthchecks." >&2
docker compose ps
exit 1
