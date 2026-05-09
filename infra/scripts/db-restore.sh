#!/usr/bin/env bash
#
# Restore a VTorn Postgres dump produced by db-backup.sh.
#
# Usage:
#   bash infra/scripts/db-restore.sh /path/to/vtorn-YYYYMMDDTHHMMSSZ.dump
#   bash infra/scripts/db-restore.sh --latest hourly
#   bash infra/scripts/db-restore.sh --latest daily
#
# Default safety: refuses to run unless POSTGRES_DB is on a development host
# (POSTGRES_HOST=localhost or matches an explicit allowlist). Override with
# VTORN_RESTORE_FORCE=1 if you really mean to restore on a remote host.
#
# Env (from .env):
#   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
#   VTORN_RESTORE_ALLOW_HOSTS  comma-separated hosts where restore is allowed
#   VTORN_BACKUP_DIR
#   VTORN_RESTORE_PII_SCRUB    if "1", run infra/db/pii-scrub.sql after restore

set -euo pipefail

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
BACKUP_DIR="${VTORN_BACKUP_DIR:-/var/backups/vtorn}"

if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "POSTGRES_PASSWORD not set" >&2; exit 3
fi

# Safety: don't restore over a non-localhost / non-allowlisted host without force.
allow="${VTORN_RESTORE_ALLOW_HOSTS:-localhost,127.0.0.1}"
if [ "${VTORN_RESTORE_FORCE:-0}" != "1" ]; then
  case ",$allow," in
    *",$POSTGRES_HOST,"*) ;;
    *)
      echo "Refusing to restore: POSTGRES_HOST=$POSTGRES_HOST not in VTORN_RESTORE_ALLOW_HOSTS=$allow" >&2
      echo "Set VTORN_RESTORE_FORCE=1 to override." >&2
      exit 5
      ;;
  esac
fi

# Pick the dump to restore.
if [ "${1:-}" = "--latest" ]; then
  TIER="${2:-daily}"
  DUMP="$(ls -1t "$BACKUP_DIR/$TIER"/vtorn-*.dump 2>/dev/null | head -1 || true)"
  if [ -z "$DUMP" ]; then
    echo "No dumps found in $BACKUP_DIR/$TIER" >&2; exit 6
  fi
else
  DUMP="${1:-}"
  if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
    echo "Usage: $0 <path-to-dump>  OR  $0 --latest [hourly|daily|weekly]" >&2
    exit 2
  fi
fi

# Verify integrity if a sidecar sha is present.
if [ -f "$DUMP.sha256" ]; then
  (cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256")
fi

echo "Restoring $DUMP into ${POSTGRES_USER}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"

PG_CONTAINER="${VTORN_PG_CONTAINER:-vtorn-postgres}"
USE_CONTAINER=0
if docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then USE_CONTAINER=1; fi

run_psql() {
  if [ "$USE_CONTAINER" = "1" ]; then
    docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_CONTAINER" \
      psql --host=localhost --port=5432 \
      --username="$POSTGRES_USER" "$@"
  else
    PGPASSWORD="$POSTGRES_PASSWORD" psql \
      --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" \
      --username="$POSTGRES_USER" "$@"
  fi
}

# Drop+recreate so we have a clean restore.
run_psql --dbname=postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS $POSTGRES_DB WITH (FORCE);" \
  -c "CREATE DATABASE $POSTGRES_DB OWNER $POSTGRES_USER;"

if [ "$USE_CONTAINER" = "1" ]; then
  cat "$DUMP" | docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_CONTAINER" \
    pg_restore --host=localhost --port=5432 \
    --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
    --no-owner --no-privileges --verbose
else
  PGPASSWORD="$POSTGRES_PASSWORD" pg_restore \
    --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" \
    --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
    --no-owner --no-privileges \
    --jobs=4 --verbose \
    "$DUMP"
fi

if [ "${VTORN_RESTORE_PII_SCRUB:-0}" = "1" ]; then
  SCRUB="$REPO_ROOT/infra/db/pii-scrub.sql"
  if [ -f "$SCRUB" ]; then
    echo "Applying PII scrub from $SCRUB"
    run_psql --dbname="$POSTGRES_DB" -v ON_ERROR_STOP=1 -f - < "$SCRUB"
  else
    echo "Warning: VTORN_RESTORE_PII_SCRUB=1 but $SCRUB doesn't exist" >&2
  fi
fi

echo "Restore complete."
