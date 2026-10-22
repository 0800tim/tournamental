#!/usr/bin/env bash
# Move session notes older than 30 days from sessions/ into
# sessions/archive/<year>/, as sessions/README.md describes.
#
# Age comes from the date prefix in the filename
# (sessions/<YYYY-MM-DD>_<agent>_<task>.md), not the file's mtime: on a
# fresh clone every file's mtime is the clone time, so a find -mtime
# recipe would archive nothing or everything.
#
# Usage, from the repo root on a chore branch:
#   scripts/archive-sessions.sh            # git mv the notes
#   scripts/archive-sessions.sh --dry-run  # print what would move
#   DAYS=60 scripts/archive-sessions.sh    # a different cutoff
#
# sessions/README.md, sessions/daily/ and sessions/screenshots/ are
# left alone. Notes already under sessions/archive/ are never touched.
set -euo pipefail

DAYS="${DAYS:-30}"
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

root="$(git rev-parse --show-toplevel)"
cd "$root"

cutoff="$(date -u -d "$DAYS days ago" +%F)"
moved=0

for path in sessions/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]_*.md; do
  [ -e "$path" ] || continue
  name="$(basename "$path")"
  day="${name:0:10}"
  # String comparison works because both sides are YYYY-MM-DD.
  if [[ "$day" < "$cutoff" ]]; then
    year="${day:0:4}"
    dest="sessions/archive/$year/$name"
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "would move $path -> $dest"
    else
      mkdir -p "sessions/archive/$year"
      git mv "$path" "$dest"
    fi
    moved=$((moved + 1))
  fi
done

if [ "$DRY_RUN" -eq 1 ]; then
  echo "$moved note(s) older than $cutoff would move"
else
  echo "$moved note(s) older than $cutoff moved into sessions/archive/"
fi
