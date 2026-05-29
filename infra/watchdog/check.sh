#!/usr/bin/env bash
# Tournamental + Aiva uptime watchdog.
#
# Runs once a minute via cron. Probes every link in the WhatsApp-login
# pipe end-to-end, plus the surrounding services. After three consecutive
# failures it WhatsApps + emails Tim. Self-mutes after alerting until the
# system goes green again so a long outage doesn't carpet-bomb his phone.
#
# Probes:
#   1. pm2 reports aiva-api as 'online'.
#   2. Port 7002 is held by pm2's aiva-api PID (no orphan AivaMiddleware).
#   3. No AivaMiddleware processes from non-canonical paths.
#   4. auth.tournamental.com/health returns 200.
#   5. play.tournamental.com/api/healthz returns 200.
#   6. game.tournamental.com/healthz returns 200.
#   7. Aiva-SMS gateway on localhost:9252 answers (any non-error response).
#
# State files live under /home/clawdbot/.vtorn-watchdog/ so the watchdog
# doesn't need root. Log is JSONL so `tail -f` is sensible.
#
# Configuration: edit ALERT_PHONE / ALERT_EMAIL at the top of this file.

set -uo pipefail

# ---------- config ----------------------------------------------------
ALERT_PHONE="+6421535832"
ALERT_EMAIL="info@growthspurt.agency"
ALERT_AFTER_FAILURES=3
AUTH_BASE="https://auth.tournamental.com"
INTERNAL_SEND_URL="${AUTH_BASE}/v1/internal/send-message"
SECRET_FILE="/home/clawdbot/clawdia/projects/vtorn/apps/auth-sms/.env"
STATE_DIR="/home/clawdbot/.vtorn-watchdog"
LOG="${STATE_DIR}/log.jsonl"
mkdir -p "$STATE_DIR"

FAIL_COUNT_FILE="${STATE_DIR}/fail_count"
ALERTED_FLAG="${STATE_DIR}/alerted"

NOW_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

log_event() {
  # log_event level event-name details-as-flat-json
  local level="$1" event="$2" details="${3:-{\}}"
  printf '{"ts":"%s","level":"%s","event":"%s","details":%s}\n' \
    "$NOW_ISO" "$level" "$event" "$details" >> "$LOG"
}

# ---------- probes ----------------------------------------------------

FAILED_PROBES=()

probe_aiva_api_online() {
  local status
  status=$(pm2 jlist 2>/dev/null | jq -r '.[] | select(.name == "aiva-api") | .pm2_env.status' 2>/dev/null)
  if [ "$status" != "online" ]; then
    FAILED_PROBES+=("aiva-api-pm2-not-online:${status:-missing}")
    return 1
  fi
  return 0
}

probe_aiva_api_port() {
  local pm2_pid listening_pid
  pm2_pid=$(pm2 jlist 2>/dev/null | jq -r '.[] | select(.name == "aiva-api") | .pid' 2>/dev/null)
  # ss outputs lines like:  LISTEN ... 0.0.0.0:7002 ... users:(("AivaMiddleware",pid=1234,fd=...))
  # Extract the pid via sed since mawk (this host's awk) lacks the
  # gawk-only `match($0, regex, array)` form.
  listening_pid=$(ss -ltnp 2>/dev/null \
    | grep ':7002 ' \
    | head -1 \
    | sed -nE 's/.*pid=([0-9]+).*/\1/p')
  if [ -z "$listening_pid" ]; then
    FAILED_PROBES+=("port-7002-not-listening")
    return 1
  fi
  if [ -z "$pm2_pid" ]; then
    # pm2 has no record of aiva-api; can't validate ownership.
    return 0
  fi
  # The listener may be pm2's own PID OR a descendant of it (dotnet run
  # wraps AivaMiddleware so pm2 tracks the wrapper, not the listener).
  # Walk the PPID chain up; if we hit pm2_pid we're fine; else orphan.
  local cur="$listening_pid"
  for _ in 1 2 3 4 5; do
    [ -z "$cur" ] || [ "$cur" = "1" ] && break
    if [ "$cur" = "$pm2_pid" ]; then
      return 0
    fi
    cur=$(ps -o ppid= -p "$cur" 2>/dev/null | tr -d ' ')
  done
  FAILED_PROBES+=("port-7002-orphan:listening=${listening_pid},pm2=${pm2_pid}")
  return 1
}

probe_no_orphan_aiva() {
  # Any AivaMiddleware process NOT from the canonical path is an orphan.
  local orphans
  orphans=$(pgrep -af AivaMiddleware 2>/dev/null \
    | grep -v "clawdia/projects/growth-spurt-aiva-platform" \
    | grep -v "watchdog" \
    | wc -l)
  if [ "$orphans" -gt 0 ]; then
    local sample
    sample=$(pgrep -af AivaMiddleware 2>/dev/null \
      | grep -v "clawdia/projects/growth-spurt-aiva-platform" \
      | grep -v "watchdog" \
      | head -1 | tr -d '"')
    FAILED_PROBES+=("aiva-orphan-procs:${orphans}")
    return 1
  fi
  return 0
}

probe_http_ok() {
  local label="$1" url="$2"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 "$url" 2>/dev/null)
  if [ "$code" != "200" ]; then
    FAILED_PROBES+=("${label}-http-${code:-timeout}")
    return 1
  fi
  return 0
}

probe_aiva_sms_gateway() {
  # 200/404 both fine, means the process answers. Connection refused / timeout = bad.
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "http://localhost:9252/health" 2>/dev/null)
  if [ -z "$code" ] || [ "$code" = "000" ]; then
    FAILED_PROBES+=("aiva-sms-gateway-unreachable")
    return 1
  fi
  return 0
}

# Run all probes (don't short-circuit; we want all failures captured).
probe_aiva_api_online || true
probe_aiva_api_port || true
probe_no_orphan_aiva || true
probe_http_ok "auth-sms" "${AUTH_BASE}/health" || true
probe_http_ok "play-web" "https://play.tournamental.com/api/healthz" || true
probe_http_ok "game-service" "https://game.tournamental.com/healthz" || true
probe_aiva_sms_gateway || true

# ---------- accounting -----------------------------------------------

if [ "${#FAILED_PROBES[@]}" -eq 0 ]; then
  # All green. Reset fail counter + mute flag. If we were alerted, send
  # the "all clear" follow-up.
  prev_failed=0
  [ -f "$FAIL_COUNT_FILE" ] && prev_failed=$(cat "$FAIL_COUNT_FILE" 2>/dev/null || echo 0)
  echo 0 > "$FAIL_COUNT_FILE"
  if [ -f "$ALERTED_FLAG" ]; then
    log_event INFO recovered "{\"prev_fail_count\":${prev_failed}}"
    SECRET=$(grep "^INTERNAL_BROADCAST_SECRET=" "$SECRET_FILE" | cut -d= -f2)
    if [ -n "${SECRET:-}" ]; then
      curl -sX POST "$INTERNAL_SEND_URL" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $SECRET" \
        -d "{\"phone\":\"${ALERT_PHONE}\",\"email\":\"${ALERT_EMAIL}\",\"subject\":\"Tournamental watchdog: RECOVERED\",\"body\":\"All probes green again. The previous failure cleared on its own or after intervention. Time: ${NOW_ISO}.\"}" \
        >/dev/null 2>&1
    fi
    rm -f "$ALERTED_FLAG"
  else
    log_event INFO green "{}"
  fi
  exit 0
fi

# Some probes failed.
prev=$(cat "$FAIL_COUNT_FILE" 2>/dev/null || echo 0)
fail_count=$((prev + 1))
echo "$fail_count" > "$FAIL_COUNT_FILE"

# Serialise the failed-probe list as a JSON array.
failed_json=$(printf '%s\n' "${FAILED_PROBES[@]}" | jq -R . | jq -s -c .)
log_event WARN probe_failed "{\"fail_count\":${fail_count},\"failed\":${failed_json}}"

# Alert if threshold crossed and we haven't already alerted for this episode.
if [ "$fail_count" -ge "$ALERT_AFTER_FAILURES" ] && [ ! -f "$ALERTED_FLAG" ]; then
  SECRET=$(grep "^INTERNAL_BROADCAST_SECRET=" "$SECRET_FILE" | cut -d= -f2)
  if [ -n "${SECRET:-}" ]; then
    BODY="Tournamental watchdog alert. ${fail_count} consecutive failed probes."
    BODY="${BODY} Failed: $(printf '%s, ' "${FAILED_PROBES[@]}" | sed 's/, $//')."
    BODY="${BODY} Log: ${LOG}."
    payload=$(jq -n \
      --arg p "$ALERT_PHONE" \
      --arg e "$ALERT_EMAIL" \
      --arg s "Tournamental watchdog: $(printf '%s, ' "${FAILED_PROBES[@]}" | sed 's/, $//')" \
      --arg b "$BODY" \
      '{phone:$p, email:$e, subject:$s, body:$b}')
    curl -sX POST "$INTERNAL_SEND_URL" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $SECRET" \
      -d "$payload" >/dev/null 2>&1
    touch "$ALERTED_FLAG"
    log_event ALERT alert_sent "{\"to_phone\":\"${ALERT_PHONE}\",\"to_email\":\"${ALERT_EMAIL}\"}"
  else
    log_event ERROR missing_secret "{\"file\":\"${SECRET_FILE}\"}"
  fi
fi
