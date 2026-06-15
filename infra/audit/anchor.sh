#!/usr/bin/env bash
# infra/audit/anchor.sh
#
# Tournamental audit anchor: produce a deterministic SQLite snapshot
# of the prediction-bearing tables, compute its SHA-256, timestamp it
# with OpenTimestamps (anchors into Bitcoin via the public calendar),
# and append the result to the public audit ledger.
#
# Run from the repo root. Idempotent enough to run on a cron; each run
# produces a new <iso-timestamp>/ directory under apps/web/data/audit/.
#
# What's in the snapshot:
#   - brackets                       picks payloads
#   - tournaments                    reference fixtures
#   - match_results                  outcomes used by the scorer
#   - syndicates                     pool metadata (no PII columns)
#   - syndicate_owners_membership    membership (handle + user_id only;
#                                    NO phone / email)
#   - users                          opaque user_id + display handle
#
# Explicitly excluded (PII / not relevant to the bet):
#   - invite_recipients, invite_jobs (contain phone + email of invitees)
#   - user_api_keys                  (secret material)
#   - syndicates_pending_ghl         (CRM sync queue)
#   - syndicate_members              (legacy, empty in prod)
#   - bracket_import_audit           (operator audit, not user data)
#   - verified_pundit_records        (TBD; keep until needed)
#   - _migrations                    (schema only)
#
# OpenTimestamps writes a "pending" .ots file immediately. ~1-3 hours
# later the calendar batches into a Bitcoin transaction; running
# `ots upgrade snapshot.db.ots` then folds the Bitcoin commitment into
# the receipt. Once upgraded, any auditor can run `ots verify` offline
# against a recent Bitcoin block header.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GAME_DB="${REPO_ROOT}/apps/game/data/game.db"
AUDIT_ROOT="${REPO_ROOT}/apps/web/data/audit"
LEDGER="${AUDIT_ROOT}/ledger.json"

OTS_BIN="${OTS_BIN:-/home/clawdbot/venv/bin/ots}"
# Tim 2026-06-16: cron's minimal PATH doesn't include linuxbrew where
# sqlite3 lives on this box, so every cron run since 2026-06-07 has
# failed with "sqlite3: command not found". Resolve via an explicit
# search across the known locations rather than relying on PATH.
if [ -z "${SQLITE_BIN:-}" ] || ! command -v "${SQLITE_BIN:-sqlite3}" >/dev/null 2>&1; then
  for cand in /home/linuxbrew/.linuxbrew/bin/sqlite3 /usr/bin/sqlite3 /usr/local/bin/sqlite3 sqlite3; do
    if command -v "$cand" >/dev/null 2>&1 || [ -x "$cand" ]; then
      SQLITE_BIN="$cand"; break
    fi
  done
fi
if ! { command -v "${SQLITE_BIN}" >/dev/null 2>&1 || [ -x "${SQLITE_BIN}" ]; }; then
  echo "[anchor] FATAL: sqlite3 not found on this box" >&2
  exit 1
fi

if [ ! -f "${GAME_DB}" ]; then
  echo "[anchor] FATAL: ${GAME_DB} not found" >&2
  exit 1
fi

if [ ! -x "${OTS_BIN}" ]; then
  echo "[anchor] FATAL: ots not executable at ${OTS_BIN}" >&2
  exit 1
fi

# Reason label is free-text; the caller passes 'kickoff:<match-id>' for
# automated anchors at match kickoff time, 'daily' for the daily cron,
# 'manual' otherwise. Stored in the ledger for context.
REASON="${1:-manual}"

# ISO-8601 UTC, second precision, filesystem-safe.
TS="$(date -u +'%Y-%m-%dT%H-%M-%SZ')"
ANCHOR_DIR="${AUDIT_ROOT}/${TS}"
mkdir -p "${ANCHOR_DIR}"

SNAP="${ANCHOR_DIR}/snapshot.db"
RAW="${ANCHOR_DIR}/snapshot.raw.db"

echo "[anchor] ${TS} reason=${REASON}"
echo "[anchor]   game.db backup → ${RAW}"
# Use the SQLite .backup pragma so the source DB can keep serving
# writes while we copy. Produces a coherent snapshot.
"${SQLITE_BIN}" "${GAME_DB}" ".backup '${RAW}'"

echo "[anchor]   strip PII tables"
"${SQLITE_BIN}" "${RAW}" <<'SQL'
DROP TABLE IF EXISTS invite_recipients;
DROP TABLE IF EXISTS invite_jobs;
DROP TABLE IF EXISTS user_api_keys;
DROP TABLE IF EXISTS syndicates_pending_ghl;
DROP TABLE IF EXISTS bracket_import_audit;
DROP TABLE IF EXISTS verified_pundit_records;
DROP TABLE IF EXISTS syndicate_members;
DROP TABLE IF EXISTS _migrations;
SQL

# VACUUM INTO produces a freshly-packed DB. Same input data always
# yields the same byte layout, so the SHA-256 below is deterministic.
echo "[anchor]   VACUUM → ${SNAP}"
"${SQLITE_BIN}" "${RAW}" "VACUUM INTO '${SNAP}'"
rm -f "${RAW}"

# Compute SHA-256 of the deterministic snapshot.
SIZE_BYTES="$(stat -c '%s' "${SNAP}")"
HASH="$(sha256sum "${SNAP}" | awk '{print $1}')"
echo "[anchor]   sha256=${HASH} size=${SIZE_BYTES}"

# Stamp with OpenTimestamps. Produces snapshot.db.ots in-place, sized
# under 1 KB. The receipt starts in "pending" state pointing at the
# public calendars; it upgrades to a Bitcoin commitment within ~3 hours.
echo "[anchor]   ots stamp"
"${OTS_BIN}" stamp "${SNAP}" 2>&1 | sed 's/^/[anchor:ots] /' || true

if [ ! -f "${SNAP}.ots" ]; then
  echo "[anchor] FATAL: ots did not produce ${SNAP}.ots" >&2
  exit 2
fi

# Append to the public ledger. Each line is a self-contained record so
# even a partial-read of the file is parseable (NDJSON style). The
# `public_sample` flag controls whether the snapshot.db itself is
# downloadable from /verify; defaults to false (Tim 2026-06-04, raw
# predictions are released only under formal audit request). Flip a
# specific entry to true to mark it as a worked example for visitors.
LEDGER_ENTRY=$(cat <<EOF
{"ts":"${TS}","reason":"${REASON}","sha256":"${HASH}","size_bytes":${SIZE_BYTES},"snapshot":"/verify/${TS}/snapshot.db","receipt":"/verify/${TS}/snapshot.db.ots","public_sample":false}
EOF
)
mkdir -p "${AUDIT_ROOT}"
echo "${LEDGER_ENTRY}" >> "${LEDGER}"

echo "[anchor] done. ledger appended: ${LEDGER}"
echo "[anchor] verify url: /verify/${TS}/"
