#!/usr/bin/env bash
#
# VTorn Postgres backup. Designed to be safe, idempotent, and cron-friendly.
#
# Usage:
#   bash infra/scripts/db-backup.sh                # one shot, prints destination
#   bash infra/scripts/db-backup.sh --hourly       # rotate hourly tier
#   bash infra/scripts/db-backup.sh --daily        # rotate daily tier (default cron)
#   bash infra/scripts/db-backup.sh --weekly       # rotate weekly tier (offsite-ready)
#
# Cron entry suggestion (root crontab):
#   17 *  * * *  /bin/bash /path/to/vtorn/infra/scripts/db-backup.sh --hourly
#   23 4  * * *  /bin/bash /path/to/vtorn/infra/scripts/db-backup.sh --daily
#   47 5  * * 0  /bin/bash /path/to/vtorn/infra/scripts/db-backup.sh --weekly
#
# Env (from .env or shell):
#   POSTGRES_HOST=localhost
#   POSTGRES_PORT=5435
#   POSTGRES_DB=vtorn
#   POSTGRES_USER=vtorn
#   POSTGRES_PASSWORD=...
#   VTORN_BACKUP_DIR=/var/backups/vtorn   # default
#   VTORN_BACKUP_OFFSITE_DIR=             # if set, weekly archives copied here
#
# Retention:
#   hourly:  last 24
#   daily:   last 7
#   weekly:  last 8 (~ 2 months)

set -euo pipefail

TIER="${1:---daily}"
TIER="${TIER#--}"
case "$TIER" in
  hourly|daily|weekly) ;;
  *) echo "Usage: $0 [--hourly|--daily|--weekly]" >&2; exit 2 ;;
esac

# Find repo root so .env loads regardless of cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5435}"
POSTGRES_DB="${POSTGRES_DB:-vtorn}"
POSTGRES_USER="${POSTGRES_USER:-vtorn}"

if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "POSTGRES_PASSWORD not set (looked in $ENV_FILE)" >&2
  exit 3
fi

BACKUP_DIR="${VTORN_BACKUP_DIR:-/var/backups/vtorn}"
TIER_DIR="$BACKUP_DIR/$TIER"
mkdir -p "$TIER_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$TIER_DIR/vtorn-${STAMP}.dump"

# Run pg_dump inside the postgres container so we always match the server
# version, and the host doesn't need postgresql-client installed.
# Falls back to a local pg_dump binary if VTORN_PG_CONTAINER is unset and
# pg_dump is on PATH (e.g. for staging/prod where the script runs against
# a remote managed database).
PG_CONTAINER="${VTORN_PG_CONTAINER:-vtorn-postgres}"

run_pgcmd() {
  local cmd="$1"; shift
  if docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
    docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_CONTAINER" \
      "$cmd" --host=localhost --port=5432 \
      --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" "$@"
  elif command -v "$cmd" >/dev/null 2>&1; then
    PGPASSWORD="$POSTGRES_PASSWORD" "$cmd" \
      --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" \
      --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" "$@"
  else
    echo "Neither container '$PG_CONTAINER' nor host '$cmd' available." >&2
    return 127
  fi
}

# pg_dump custom format: compressed, parallel-restore-capable, schema+data.
# Stream to host file (Docker pipes stdout out of the container).
if docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
  docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_CONTAINER" \
    pg_dump --host=localhost --port=5432 \
    --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
    --format=custom --compress=6 --no-owner --no-privileges \
    > "$OUT" 2>/tmp/vtorn-backup-$$.log || {
      echo "pg_dump failed; tail of log:" >&2
      tail -40 /tmp/vtorn-backup-$$.log >&2
      rm -f /tmp/vtorn-backup-$$.log "$OUT"
      exit 4
    }
else
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
    --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" \
    --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
    --format=custom --compress=6 --no-owner --no-privileges --verbose \
    --file="$OUT" >/tmp/vtorn-backup-$$.log 2>&1 || {
      echo "pg_dump failed; tail of log:" >&2
      tail -40 /tmp/vtorn-backup-$$.log >&2
      rm -f /tmp/vtorn-backup-$$.log "$OUT"
      exit 4
    }
fi
rm -f /tmp/vtorn-backup-$$.log

# Verify the dump. pg_restore --list returns nonzero on a corrupt dump.
if docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
  cat "$OUT" | docker exec -i "$PG_CONTAINER" pg_restore --list >/dev/null
else
  pg_restore --list "$OUT" >/dev/null
fi

# Hash for integrity verification.
sha256sum "$OUT" > "$OUT.sha256"

# Retention: keep the last N depending on tier.
case "$TIER" in
  hourly)  KEEP=24 ;;
  daily)   KEEP=7  ;;
  weekly)  KEEP=8  ;;
esac

# Newest-first; delete past KEEP. Pair the .dump with its .sha256.
ls -1t "$TIER_DIR"/vtorn-*.dump 2>/dev/null \
  | awk -v keep="$KEEP" 'NR > keep' \
  | while read -r old; do
      rm -f "$old" "$old.sha256"
    done

# Optional offsite mirror for weekly archives. The user fills in
# VTORN_BACKUP_OFFSITE_DIR (e.g. an S3/R2-mounted path or rclone target).
if [ "$TIER" = "weekly" ] && [ -n "${VTORN_BACKUP_OFFSITE_DIR:-}" ]; then
  mkdir -p "$VTORN_BACKUP_OFFSITE_DIR"
  cp -p "$OUT" "$OUT.sha256" "$VTORN_BACKUP_OFFSITE_DIR/"
fi

echo "$OUT"
