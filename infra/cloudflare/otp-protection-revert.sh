#!/usr/bin/env bash
# Revert the OTP brute-force protection rules applied by
# `infra/cloudflare/otp-protection.sh`.
#
# The forward script identifies every rule it creates by a stable
# `description` string; this script reads the current entrypoint
# rulesets, strips any rule with one of those descriptions out, and
# PUTs the trimmed list back. Bot Fight Mode is set to false.
#
# Idempotent: running this when nothing is in place is a no-op (the
# filter step finds nothing to remove and the PUT is identical to
# what's already there).
#
# Required env (same as the forward script):
#   CLOUDFLARE_API_TOKEN
#   CLOUDFLARE_ZONE_ID
#
# Flags:
#   --dry-run             Print every API call and exit; do NOT mutate.

set -euo pipefail

DESC_SEND="tournamental-otp-send-rate-limit"
DESC_VERIFY="tournamental-otp-verify-rate-limit"
DESC_WILD="tournamental-otp-aggregate-rate-limit"
DESC_ASN="tournamental-otp-asn-managed-challenge"

API_BASE="https://api.cloudflare.com/client/v4"

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN is not set." >&2; exit 1
fi
if [ -z "${CLOUDFLARE_ZONE_ID:-}" ]; then
  echo "ERROR: CLOUDFLARE_ZONE_ID is not set." >&2; exit 1
fi
command -v jq >/dev/null || { echo "ERROR: jq is required." >&2; exit 1; }
command -v curl >/dev/null || { echo "ERROR: curl is required." >&2; exit 1; }

cf_call() {
  local method="$1" url="$2" body="${3:-}"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY-RUN: $method $url"
    if [ -n "$body" ]; then echo "$body" | jq . 2>/dev/null || echo "$body"; fi
    return 0
  fi
  local args=(-sS -X "$method" "$url"
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
    -H "Content-Type: application/json")
  if [ -n "$body" ]; then args+=(--data "$body"); fi
  local resp http
  resp=$(curl "${args[@]}" -w '\n%{http_code}')
  http="${resp##*$'\n'}"
  resp="${resp%$'\n'*}"
  echo "  HTTP $http"
  echo "$resp" | jq '{success, errors: (.errors // [])}' 2>/dev/null || echo "$resp"
  case "$http" in 2*) ;; *) echo "ERROR: $method $url -> $http" >&2; exit 1 ;; esac
  echo "$resp"
}

echo "Reverting OTP brute-force protection on zone $CLOUDFLARE_ZONE_ID..."

# --- Strip rate-limit rules ---

RL_URL="$API_BASE/zones/$CLOUDFLARE_ZONE_ID/rulesets/phases/http_ratelimit/entrypoint"

if [ "$DRY_RUN" -eq 1 ]; then
  cf_call GET "$RL_URL"
  rl_rules='[]'
else
  cur=$(cf_call GET "$RL_URL" || true)
  rl_rules=$(echo "$cur" | jq '.result.rules // []' 2>/dev/null || echo '[]')
fi
trimmed_rl=$(echo "$rl_rules" \
  | jq --arg s "$DESC_SEND" --arg v "$DESC_VERIFY" --arg w "$DESC_WILD" \
       '[.[] | select(.description != $s and .description != $v and .description != $w)]')
cf_call PUT "$RL_URL" "$(jq -n --argjson r "$trimmed_rl" '{rules: $r}')"

# --- Strip WAF custom rule ---

WAF_URL="$API_BASE/zones/$CLOUDFLARE_ZONE_ID/rulesets/phases/http_request_firewall_custom/entrypoint"

if [ "$DRY_RUN" -eq 1 ]; then
  cf_call GET "$WAF_URL"
  waf_rules='[]'
else
  cur=$(cf_call GET "$WAF_URL" || true)
  waf_rules=$(echo "$cur" | jq '.result.rules // []' 2>/dev/null || echo '[]')
fi
trimmed_waf=$(echo "$waf_rules" \
  | jq --arg a "$DESC_ASN" '[.[] | select(.description != $a)]')
cf_call PUT "$WAF_URL" "$(jq -n --argjson r "$trimmed_waf" '{rules: $r}')"

# --- Bot Fight Mode off ---

BOT_URL="$API_BASE/zones/$CLOUDFLARE_ZONE_ID/bot_management"
cf_call PUT "$BOT_URL" '{"fight_mode": false}'

echo
if [ "$DRY_RUN" -eq 1 ]; then
  echo "DRY-RUN complete. Re-run without --dry-run to apply."
else
  echo "Revert complete. OTP-specific rules removed; Bot Fight Mode off."
fi
