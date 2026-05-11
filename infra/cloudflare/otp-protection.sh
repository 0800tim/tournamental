#!/usr/bin/env bash
# Apply Tournamental OTP brute-force protection rules to the tournamental.com
# zone via the Cloudflare API. Idempotent: re-running updates the rules
# in place rather than appending duplicates.
#
# What this configures:
#
#   - Rate-limiting ruleset on the entrypoint phase:
#       1. /v1/auth/otp/send       10 req/min/IP -> managed_challenge
#       2. /v1/auth/otp/verify     15 req/min/IP -> block 10m
#       3. /v1/auth/otp/*  (any)   30 req/min/IP -> block 1h
#   - WAF custom ruleset that managed-challenges /v1/auth/otp/* traffic
#     from a starter list of ASNs known to host OTP-spam infrastructure
#     (Twilio / mass-VPS providers). The list is intentionally
#     conservative; add ASNs as we observe abuse.
#   - Bot Fight Mode enabled at the zone level so cloudflare-detected
#     bots hitting the OTP routes get a managed challenge by default.
#
# Why managed-challenge over block: a managed challenge is invisible to
# real users on a healthy network and is the lightest-touch UX. A
# straight block is reserved for the aggregated "burst" rule because
# anyone hitting 30 req/min on /v1/auth/otp/* is not a human.
#
# Idempotency strategy: every rule has a stable description (see
# RULE_DESCRIPTIONS below). Before each PUT we read the existing
# ruleset, drop any rules whose description matches one of ours, then
# append the fresh set. Net effect: re-running this script is a no-op
# if nothing has changed, and a clean replace if it has.
#
# Required env (loaded from your shell or `source` a credentials file
# before running):
#
#   CLOUDFLARE_API_TOKEN  - token with Zone:Edit + WAF:Edit + Bot
#                           Management:Edit on the tournamental.com zone
#   CLOUDFLARE_ZONE_ID    - the tournamental.com zone id
#
# Flags:
#   --dry-run             Print every API call and exit; do NOT mutate.
#   -h | --help           Show this help and exit 0.

set -euo pipefail

# -------- Configuration (edit thresholds here, not at the call sites) --------

ZONE_HOSTS="tournamental.com"
SEND_PATH="/v1/auth/otp/send"
VERIFY_PATH="/v1/auth/otp/verify"
WILD_PATH="/v1/auth/otp/"  # used in a "starts_with" match

# All rule descriptions are stable identifiers , DO NOT change the text
# without also bumping the revert script.
DESC_SEND="tournamental-otp-send-rate-limit"
DESC_VERIFY="tournamental-otp-verify-rate-limit"
DESC_WILD="tournamental-otp-aggregate-rate-limit"
DESC_ASN="tournamental-otp-asn-managed-challenge"
DESC_BOT="tournamental-otp-bot-fight-mode"

# Starter ASN list , entries are (ASN, reason). We managed-challenge
# /v1/auth/otp/* traffic originating from these ASNs because they have
# historically been heavy contributors to OTP-spam / SMS-toll-fraud
# patterns. Tune with `--dry-run` first.
ASN_LIST=(
  "AS396982 Google-Cloud-Platform: residential-proxy abuse"
  "AS14618  Amazon-AES: heavy bot traffic against auth endpoints"
  "AS16509  Amazon-AWS: same"
  "AS14061  DigitalOcean: bulk VPS provider, common OTP-spam source"
  "AS63949  Linode/Akamai: bulk VPS provider"
  "AS24940  Hetzner: bulk VPS provider"
  "AS9009   M247: high abuse score per AbuseIPDB"
)

API_BASE="https://api.cloudflare.com/client/v4"

# -------- argparse --------

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,50p' "$0"
      exit 0
      ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# -------- env --------

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN is not set." >&2
  echo "       Source your credentials file first, e.g.:" >&2
  echo "         source ~/.cloudflared/cf-api-token" >&2
  exit 1
fi
if [ -z "${CLOUDFLARE_ZONE_ID:-}" ]; then
  echo "ERROR: CLOUDFLARE_ZONE_ID is not set." >&2
  echo "       Set it to the tournamental.com zone id." >&2
  exit 1
fi

command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required." >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is required." >&2; exit 1; }

# -------- helpers --------

# emit "<METHOD> <URL>" + body in dry-run, otherwise actually call.
cf_call() {
  local method="$1"
  local url="$2"
  local body="${3:-}"

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY-RUN: $method $url"
    if [ -n "$body" ]; then
      echo "$body" | jq . 2>/dev/null || echo "$body"
    fi
    return 0
  fi

  local args=(-sS -X "$method" "$url"
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
    -H "Content-Type: application/json")
  if [ -n "$body" ]; then
    args+=(--data "$body")
  fi
  local resp http
  resp=$(curl "${args[@]}" -w '\n%{http_code}')
  http="${resp##*$'\n'}"
  resp="${resp%$'\n'*}"
  echo "  HTTP $http"
  echo "$resp" | jq '{success, errors: (.errors // []), messages: (.messages // [])}' 2>/dev/null || echo "$resp"
  case "$http" in
    2*) ;;
    *)
      echo "ERROR: Cloudflare returned $http for $method $url" >&2
      exit 1
      ;;
  esac
  echo "$resp"
}

# Build the JSON expression Cloudflare uses to match an exact path on
# the zone's hostnames. We pin to tournamental.com only so the rule does
# not apply to other hosts that might share the account.
match_exact_path() {
  local path="$1"
  printf '(http.host eq "%s" and http.request.uri.path eq "%s")' \
    "$ZONE_HOSTS" "$path"
}

match_path_prefix() {
  local prefix="$1"
  printf '(http.host eq "%s" and starts_with(http.request.uri.path, "%s"))' \
    "$ZONE_HOSTS" "$prefix"
}

# Build the ASN-match expression: ip.geoip.asnum in {1234 5678 ...}.
asn_match() {
  local nums=()
  for entry in "${ASN_LIST[@]}"; do
    # Strip the leading "AS" if present, take the first whitespace-
    # separated token.
    local first
    first="$(echo "$entry" | awk '{print $1}')"
    first="${first#AS}"
    nums+=("$first")
  done
  local joined=""
  for n in "${nums[@]}"; do
    if [ -z "$joined" ]; then
      joined="$n"
    else
      joined="$joined $n"
    fi
  done
  printf '(%s and ip.geoip.asnum in {%s})' \
    "$(match_path_prefix "$WILD_PATH")" "$joined"
}

# -------- preview --------

echo "About to apply OTP brute-force protection to zone $CLOUDFLARE_ZONE_ID:"
echo
echo "  1. Rate-limit  $SEND_PATH    -> 10 req/min/IP   -> managed_challenge"
echo "  2. Rate-limit  $VERIFY_PATH  -> 15 req/min/IP   -> block 10m"
echo "  3. Rate-limit  $WILD_PATH*   -> 30 req/min/IP   -> block 1h"
echo "  4. WAF         $WILD_PATH*   from suspicious ASNs -> managed_challenge"
echo "     ASNs:"
for entry in "${ASN_LIST[@]}"; do
  echo "       - $entry"
done
echo "  5. Bot Fight Mode: ON (zone-level)"
echo

if [ "$DRY_RUN" -eq 1 ]; then
  echo "(dry-run: no API calls will be made.)"
  echo
fi

# -------- step 1+2+3: rate-limiting ruleset --------
#
# Cloudflare's rate-limiting v2 lives on the "http_ratelimit" phase
# entrypoint ruleset. We fetch it, strip any of our prior rules out by
# description, append the new rules, and PUT it back.

RL_ENTRYPOINT_URL="$API_BASE/zones/$CLOUDFLARE_ZONE_ID/rulesets/phases/http_ratelimit/entrypoint"

echo "--- Step 1: Rate-limiting ruleset ---"

if [ "$DRY_RUN" -eq 1 ]; then
  cf_call GET "$RL_ENTRYPOINT_URL"
  existing_rules='[]'
else
  cur=$(cf_call GET "$RL_ENTRYPOINT_URL" || true)
  # If the entrypoint doesn't exist yet, this 404s , that's fine.
  existing_rules=$(echo "$cur" | jq '.result.rules // []' 2>/dev/null || echo '[]')
fi

# Drop our own descriptions out, then append fresh.
filtered=$(echo "$existing_rules" \
  | jq --arg s "$DESC_SEND" --arg v "$DESC_VERIFY" --arg w "$DESC_WILD" \
       '[.[] | select(.description != $s and .description != $v and .description != $w)]')

new_send=$(jq -n \
  --arg desc "$DESC_SEND" \
  --arg expr "$(match_exact_path "$SEND_PATH")" \
  '{
    description: $desc,
    expression: $expr,
    action: "managed_challenge",
    ratelimit: {
      characteristics: ["ip.src"],
      period: 60,
      requests_per_period: 10,
      mitigation_timeout: 600
    }
  }')

new_verify=$(jq -n \
  --arg desc "$DESC_VERIFY" \
  --arg expr "$(match_exact_path "$VERIFY_PATH")" \
  '{
    description: $desc,
    expression: $expr,
    action: "block",
    ratelimit: {
      characteristics: ["ip.src"],
      period: 60,
      requests_per_period: 15,
      mitigation_timeout: 600
    }
  }')

new_wild=$(jq -n \
  --arg desc "$DESC_WILD" \
  --arg expr "$(match_path_prefix "$WILD_PATH")" \
  '{
    description: $desc,
    expression: $expr,
    action: "block",
    ratelimit: {
      characteristics: ["ip.src"],
      period: 60,
      requests_per_period: 30,
      mitigation_timeout: 3600
    }
  }')

rl_body=$(jq -n --argjson rules "$filtered" \
                --argjson s "$new_send" \
                --argjson v "$new_verify" \
                --argjson w "$new_wild" \
  '{rules: ($rules + [$s, $v, $w])}')

cf_call PUT "$RL_ENTRYPOINT_URL" "$rl_body"

# -------- step 4: WAF custom ruleset (ASN managed-challenge) --------

WAF_ENTRYPOINT_URL="$API_BASE/zones/$CLOUDFLARE_ZONE_ID/rulesets/phases/http_request_firewall_custom/entrypoint"

echo
echo "--- Step 2: WAF custom rules (ASN managed-challenge) ---"

if [ "$DRY_RUN" -eq 1 ]; then
  cf_call GET "$WAF_ENTRYPOINT_URL"
  existing_waf='[]'
else
  cur=$(cf_call GET "$WAF_ENTRYPOINT_URL" || true)
  existing_waf=$(echo "$cur" | jq '.result.rules // []' 2>/dev/null || echo '[]')
fi

filtered_waf=$(echo "$existing_waf" \
  | jq --arg a "$DESC_ASN" \
       '[.[] | select(.description != $a)]')

new_asn=$(jq -n \
  --arg desc "$DESC_ASN" \
  --arg expr "$(asn_match)" \
  '{
    description: $desc,
    expression: $expr,
    action: "managed_challenge"
  }')

waf_body=$(jq -n --argjson rules "$filtered_waf" \
                 --argjson a "$new_asn" \
  '{rules: ($rules + [$a])}')

cf_call PUT "$WAF_ENTRYPOINT_URL" "$waf_body"

# -------- step 5: Bot Fight Mode --------

BOT_URL="$API_BASE/zones/$CLOUDFLARE_ZONE_ID/bot_management"

echo
echo "--- Step 3: Bot Fight Mode (zone-level) ---"

bot_body='{"fight_mode": true}'
cf_call PUT "$BOT_URL" "$bot_body"

# -------- done --------

echo
if [ "$DRY_RUN" -eq 1 ]; then
  echo "DRY-RUN complete. Re-run without --dry-run to apply."
else
  echo "OTP brute-force protection applied. Smoke test:"
  echo "  curl -i -X POST https://tournamental.com$SEND_PATH \\"
  echo "    --data '{\"phone\":\"+6421999000\",\"channel\":\"sms\"}'"
  echo "  Expect: a normal 200, then a managed_challenge after ~10/min."
fi
