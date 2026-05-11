#!/usr/bin/env bash
# Bash-level test for infra/cloudflare/otp-protection.sh in --dry-run
# mode. Verifies that:
#
#   - Running without CLOUDFLARE_API_TOKEN exits 1 with a readable error.
#   - Running without CLOUDFLARE_ZONE_ID exits 1 with a readable error.
#   - --dry-run with both env vars set:
#       * Exits 0.
#       * Prints all five intended API operations
#         (one GET + one PUT for rate-limit, ditto for WAF, one PUT for
#          Bot Fight Mode).
#       * Renders the three rate-limit thresholds (10/15/30 req/min).
#       * Renders the ASN list with at least 5 entries.
#       * NEVER attempts a real curl (no Authorization header in output).
#
# Run from the repo root: bash infra/cloudflare/test/otp-protection-dryrun.test.sh
#
# Exits 0 on success, 1 on any failure.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="$SCRIPT_DIR/../otp-protection.sh"
REVERT="$SCRIPT_DIR/../otp-protection-revert.sh"

if [ ! -x "$TARGET" ]; then
  echo "FAIL: $TARGET not executable"; exit 1
fi
if [ ! -x "$REVERT" ]; then
  echo "FAIL: $REVERT not executable"; exit 1
fi

PASS=0
FAIL=0

assert_contains() {
  local name="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    echo "  ok: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name"
    echo "    expected to find: $needle"
    FAIL=$((FAIL + 1))
  fi
}

assert_not_contains() {
  local name="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    echo "  FAIL: $name"
    echo "    expected NOT to find: $needle"
    FAIL=$((FAIL + 1))
  else
    echo "  ok: $name"
    PASS=$((PASS + 1))
  fi
}

# ---- missing env should fail loud ----

echo "test: missing CLOUDFLARE_API_TOKEN"
out=$(env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ZONE_ID bash "$TARGET" --dry-run 2>&1; echo "EXIT=$?")
assert_contains "exit non-zero" "$out" "EXIT=1"
assert_contains "error message" "$out" "CLOUDFLARE_API_TOKEN is not set"

echo "test: missing CLOUDFLARE_ZONE_ID"
out=$(env -u CLOUDFLARE_ZONE_ID CLOUDFLARE_API_TOKEN=dummy bash "$TARGET" --dry-run 2>&1; echo "EXIT=$?")
assert_contains "exit non-zero" "$out" "EXIT=1"
assert_contains "error message" "$out" "CLOUDFLARE_ZONE_ID is not set"

# ---- happy-path dry-run ----

echo "test: dry-run with env present"
out=$(CLOUDFLARE_API_TOKEN=dummy CLOUDFLARE_ZONE_ID=zone-abc bash "$TARGET" --dry-run 2>&1; echo "EXIT=$?")
assert_contains "exits 0" "$out" "EXIT=0"
assert_contains "rate-limit GET (preview)" "$out" "DRY-RUN: GET https://api.cloudflare.com/client/v4/zones/zone-abc/rulesets/phases/http_ratelimit/entrypoint"
assert_contains "rate-limit PUT (preview)" "$out" "DRY-RUN: PUT https://api.cloudflare.com/client/v4/zones/zone-abc/rulesets/phases/http_ratelimit/entrypoint"
assert_contains "WAF GET (preview)"        "$out" "DRY-RUN: GET https://api.cloudflare.com/client/v4/zones/zone-abc/rulesets/phases/http_request_firewall_custom/entrypoint"
assert_contains "WAF PUT (preview)"        "$out" "DRY-RUN: PUT https://api.cloudflare.com/client/v4/zones/zone-abc/rulesets/phases/http_request_firewall_custom/entrypoint"
assert_contains "Bot Fight Mode PUT"       "$out" "DRY-RUN: PUT https://api.cloudflare.com/client/v4/zones/zone-abc/bot_management"

# Thresholds present.
assert_contains "send threshold (10)"   "$out" '"requests_per_period": 10'
assert_contains "verify threshold (15)" "$out" '"requests_per_period": 15'
assert_contains "wild threshold (30)"   "$out" '"requests_per_period": 30'

# Rules use the documented stable descriptions.
assert_contains "send rule description"   "$out" "tournamental-otp-send-rate-limit"
assert_contains "verify rule description" "$out" "tournamental-otp-verify-rate-limit"
assert_contains "wild rule description"   "$out" "tournamental-otp-aggregate-rate-limit"
assert_contains "ASN rule description"    "$out" "tournamental-otp-asn-managed-challenge"

# ASN list shows at least our starter entries.
asn_count=$(echo "$out" | grep -c "       - AS")
if [ "$asn_count" -ge 5 ]; then
  echo "  ok: ASN list has at least 5 entries ($asn_count)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: ASN list has only $asn_count entries"
  FAIL=$((FAIL + 1))
fi

# Bot Fight Mode body is correct.
assert_contains "bot fight mode body" "$out" '"fight_mode": true'

# Sanity: dry-run never logs the secret.
assert_not_contains "no token in output" "$out" "Authorization:"

# ---- revert dry-run ----

echo "test: revert dry-run"
out=$(CLOUDFLARE_API_TOKEN=dummy CLOUDFLARE_ZONE_ID=zone-abc bash "$REVERT" --dry-run 2>&1; echo "EXIT=$?")
assert_contains "revert exits 0" "$out" "EXIT=0"
assert_contains "revert rate-limit GET" "$out" "DRY-RUN: GET https://api.cloudflare.com/client/v4/zones/zone-abc/rulesets/phases/http_ratelimit/entrypoint"
assert_contains "revert sets fight_mode false" "$out" '"fight_mode": false'
assert_not_contains "no token in revert output" "$out" "Authorization:"

echo
echo "== Summary =="
echo "  passed: $PASS"
echo "  failed: $FAIL"
if [ "$FAIL" -ne 0 ]; then exit 1; fi
exit 0
