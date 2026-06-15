#!/usr/bin/env bash
#
# game-db-pre-kickoff-backup.sh
#
# Snapshots the prod game.db SQLite file ~10 minutes before every match
# kickoff. Designed to run from cron once per minute; idempotent: it
# only backs up when the current minute lies inside the 10..11 minutes
# before a kickoff window, and skips otherwise. SQLite is backed up via
# `.backup` which produces a consistent snapshot on a live DB without
# blocking writes.
#
# Born from the SEC-BRK-02 incident (Tim 2026-06-12) where the autosave
# was silently destroying picks at kickoff and we had no backup to roll
# forward from.
#
# Cron entry (one-shot, install once):
#   * * * * * /home/clawdbot/clawdia/projects/vtorn/infra/scripts/game-db-pre-kickoff-backup.sh >/dev/null 2>&1
#
# To install: `crontab -e` and paste the line. Or:
#   ( crontab -l 2>/dev/null; echo "* * * * * $PWD/infra/scripts/game-db-pre-kickoff-backup.sh" ) | crontab -

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DB_PATH="${GAME_DB_PATH:-$REPO_ROOT/apps/game/data/game.db}"
FIXTURES_PATH="${FIXTURES_PATH:-$REPO_ROOT/apps/billion-bot/fifa-wc-2026-fixtures.json}"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups/game-db}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"
LEAD_MINUTES_MIN=10
LEAD_MINUTES_MAX=11

# Tim 2026-06-16: cron's PATH doesn't include linuxbrew where sqlite3
# lives on this host; same fix as infra/audit/anchor.sh. Resolve the
# binary explicitly so the cron run actually produces files.
for cand in /home/linuxbrew/.linuxbrew/bin/sqlite3 /usr/bin/sqlite3 /usr/local/bin/sqlite3 sqlite3; do
  if command -v "$cand" >/dev/null 2>&1 || [ -x "$cand" ]; then
    SQLITE_BIN="$cand"; break
  fi
done
if [ -z "${SQLITE_BIN:-}" ]; then
  echo "$(date -u +%FT%TZ) FATAL: sqlite3 not found on this box" >&2
  exit 1
fi
OTS_BIN="${OTS_BIN:-/home/clawdbot/venv/bin/ots}"

mkdir -p "$BACKUP_DIR"

now_s=$(date -u +%s)
window_lo=$(( now_s + LEAD_MINUTES_MIN * 60 ))
window_hi=$(( now_s + LEAD_MINUTES_MAX * 60 ))

# Find any fixture whose kickoff_utc falls inside the lead window. If
# none, exit silently — this minute is not a backup minute.
matched_match_id=$(
  python3 - "$FIXTURES_PATH" "$window_lo" "$window_hi" <<'PY'
import json, sys
from datetime import datetime, timezone

path, lo, hi = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
with open(path) as f:
    fx = json.load(f)
matches = fx if isinstance(fx, list) else fx.get("matches", [])
for m in matches:
    iso = m.get("kickoff_utc")
    if not iso: continue
    try:
        ts = int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())
    except Exception:
        continue
    if lo <= ts < hi:
        print(m.get("match_id") or m.get("match_no") or "?")
        break
PY
)

if [[ -z "$matched_match_id" ]]; then
  exit 0
fi

# Skip the backup if one for this match was already taken this minute
# (idempotency guard).
stamp=$(date -u +"%Y%m%dT%H%M%SZ")
target="$BACKUP_DIR/game.db.${matched_match_id}.${stamp}.bak"
existing="$(find "$BACKUP_DIR" -maxdepth 1 -name "game.db.${matched_match_id}.*.bak" -mmin -2 2>/dev/null | head -1)"
if [[ -n "$existing" ]]; then
  exit 0
fi

# Run the SQLite backup. `.backup` is the canonical safe-on-live-DB
# command — it copies pages while holding short locks so writers are
# barely delayed. The output file is a complete, consistent DB ready to
# open with sqlite3 directly.
if ! "$SQLITE_BIN" "$DB_PATH" ".backup '$target'"; then
  echo "$(date -u +%FT%TZ) FAILED backup before match=$matched_match_id" >&2
  exit 2
fi

# Verify the snapshot opens + has the brackets table populated (cheap
# sanity check; abort and remove the file if it looks empty).
n=$("$SQLITE_BIN" "$target" "SELECT COUNT(*) FROM brackets WHERE tournament_id='fifa-wc-2026'" 2>/dev/null || echo 0)
if [[ "$n" -lt 1 ]]; then
  echo "$(date -u +%FT%TZ) BAD snapshot (brackets=$n) at $target — removing" >&2
  rm -f "$target"
  exit 3
fi

# Tim 2026-06-16: hash + OpenTimestamps stamp the snapshot so each
# pre-kickoff backup carries a verifiable Bitcoin-anchored receipt of
# its existence at the kickoff moment. ~1KB .ots file lives next to
# the .bak. Previously only the daily anchor stamped (and that was
# broken too — see infra/audit/anchor.sh fix from the same date).
sha256="$(sha256sum "$target" | awk '{print $1}')"
ots_status="ots-skipped"
if [ -x "$OTS_BIN" ]; then
  if "$OTS_BIN" stamp "$target" >/dev/null 2>&1 && [ -f "${target}.ots" ]; then
    ots_status="ots-pending"
  else
    ots_status="ots-failed"
  fi
fi

# Log success to a tiny rolling journal so ops can see what fired.
journal="$BACKUP_DIR/journal.log"
echo "$(date -u +%FT%TZ) ok match=$matched_match_id brackets=$n sha256=$sha256 $ots_status -> $(basename "$target")" >> "$journal"

# Rotate: drop anything older than $RETAIN_DAYS (.bak + .ots together)
# so the backup dir does not grow unbounded.
find "$BACKUP_DIR" -maxdepth 1 \( -name "game.db.*.bak" -o -name "game.db.*.bak.ots" \) -type f -mtime +$RETAIN_DAYS -delete 2>/dev/null || true

exit 0
