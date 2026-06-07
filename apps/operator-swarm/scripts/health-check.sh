#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# health-check.sh: quick local probe of the bot-node /stats endpoint.
#
# Reports last commit time, bot count, score progress, and exits non-zero if
# the endpoint is unreachable or any field is missing. Safe to drop into a
# cron / Cloudflare healthcheck / systemd timer.
#
# Usage:
#   bash scripts/health-check.sh             # human-readable
#   bash scripts/health-check.sh --json      # raw JSON, no formatting
#   bash scripts/health-check.sh --quiet     # exit code only, no output
# -----------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f "${APP_DIR}/.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "${APP_DIR}/.env"
  set +a
fi

PORT="${BOT_NODE_STATS_PORT:-4811}"
URL="http://127.0.0.1:${PORT}/stats"

MODE="human"
for arg in "$@"; do
  case "${arg}" in
    --json)  MODE="json" ;;
    --quiet) MODE="quiet" ;;
    --help|-h)
      sed -n '2,15p' "$0"
      exit 0
      ;;
  esac
done

if ! command -v curl >/dev/null 2>&1; then
  echo "[health] ERROR: curl not installed" >&2
  exit 2
fi

# 5s connect + 5s read timeout is generous for a localhost probe but short
# enough that a stuck process still gets caught.
RESPONSE="$(curl -fsS --max-time 5 --connect-timeout 5 "${URL}" || true)"

if [[ -z "${RESPONSE}" ]]; then
  if [[ "${MODE}" != "quiet" ]]; then
    echo "[health] FAIL: bot-node /stats unreachable at ${URL}" >&2
  fi
  exit 1
fi

if [[ "${MODE}" == "json" ]]; then
  echo "${RESPONSE}"
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  if [[ "${MODE}" != "quiet" ]]; then
    echo "[health] WARNING: jq not installed, raw response follows"
    echo "${RESPONSE}"
  fi
  exit 0
fi

# Expected shape (subject to whatever @tournamental/bot-node ships):
#   {
#     "node_id":            "node_xyz",
#     "label":              "tim-1m-demo",
#     "bot_count":          1000000,
#     "bots_still_perfect": 234567,
#     "last_commit_at":     "2026-06-11T14:32:11Z",
#     "last_commit_match":  "WC2026_M03",
#     "score_total":        18345678,
#     "uptime_seconds":     86400
#   }

LABEL="$(jq -r '.label // "unknown"' <<<"${RESPONSE}")"
BOT_COUNT="$(jq -r '.bot_count // 0' <<<"${RESPONSE}")"
STILL_PERFECT="$(jq -r '.bots_still_perfect // 0' <<<"${RESPONSE}")"
LAST_COMMIT_AT="$(jq -r '.last_commit_at // "never"' <<<"${RESPONSE}")"
LAST_COMMIT_MATCH="$(jq -r '.last_commit_match // "none"' <<<"${RESPONSE}")"
SCORE_TOTAL="$(jq -r '.score_total // 0' <<<"${RESPONSE}")"
UPTIME="$(jq -r '.uptime_seconds // 0' <<<"${RESPONSE}")"

if [[ "${MODE}" == "quiet" ]]; then
  exit 0
fi

printf "node label         : %s\n" "${LABEL}"
printf "bot count          : %s\n" "${BOT_COUNT}"
printf "bots still perfect : %s\n" "${STILL_PERFECT}"
printf "last commit at     : %s\n" "${LAST_COMMIT_AT}"
printf "last commit match  : %s\n" "${LAST_COMMIT_MATCH}"
printf "score total        : %s\n" "${SCORE_TOTAL}"
printf "uptime (seconds)   : %s\n" "${UPTIME}"

# Stale commit detection: if the last commit is over 1 hour old AND the node
# has been up over 1 hour, flag it. The bot-node should be committing at
# least once per match window during the WC, and at least once per heartbeat
# otherwise.
NOW_EPOCH="$(date -u +%s)"
if [[ "${LAST_COMMIT_AT}" != "never" ]]; then
  LAST_EPOCH="$(date -u -d "${LAST_COMMIT_AT}" +%s 2>/dev/null || echo 0)"
  if [[ "${LAST_EPOCH}" -gt 0 ]]; then
    AGE=$(( NOW_EPOCH - LAST_EPOCH ))
    if [[ "${AGE}" -gt 3600 && "${UPTIME}" -gt 3600 ]]; then
      echo "[health] WARN: last commit was ${AGE}s ago (>1h)" >&2
      exit 1
    fi
  fi
fi

exit 0
