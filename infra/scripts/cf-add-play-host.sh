#!/usr/bin/env bash
# Add play.tournamental.com to the clawdbot-workstation tunnel via the
# Cloudflare API. Idempotent: re-running is a no-op once the ingress
# entry + DNS CNAME are in place.
#
# Why a dedicated host: play.tournamental.com is the "play the
# tournament" landing surface — the bracket builder at /world-cup-2026.
# Next.js middleware in apps/web/middleware.ts rewrites `/` to
# `/world-cup-2026` only when Host matches this domain, so the rest of
# the routes (/match/*, /profile, etc.) keep working transparently.
#
# Prereq: $CLOUDFLARE_API_TOKEN with Cloudflare Tunnel:Edit +
# Zone.DNS:Edit on tournamental.com. Lives in
# /home/clawdbot/.cloudflared/cf-api-token (key=value format).

set -euo pipefail
# shellcheck disable=SC1091
source /home/clawdbot/.cloudflared/cf-api-token

ACCOUNT_ID=f08ad6bd468886c7d991a817b3bbbeba
TUNNEL_NAME="clawdbot-workstation"

TUNNEL_ID=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel" \
  | jq -r ".result[] | select(.name==\"$TUNNEL_NAME\") | .id" | head -1)
[ -z "$TUNNEL_ID" ] && { echo "ERROR: no tunnel named $TUNNEL_NAME"; exit 1; }
echo "Tunnel: $TUNNEL_ID ($TUNNEL_NAME)"

ZONE_ID=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones?name=tournamental.com" \
  | jq -r '.result[0].id')
[ "$ZONE_ID" = "null" ] && { echo "ERROR: tournamental.com zone not visible"; exit 1; }
echo "Zone: $ZONE_ID (tournamental.com)"

CFG_URL="https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations"

curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$CFG_URL" > /tmp/cf-cur-play.json

HAS_PLAY=$(jq '.result.config.ingress[] | select(.hostname=="play.tournamental.com")' /tmp/cf-cur-play.json)
if [ -n "$HAS_PLAY" ]; then
  echo "Ingress already has play.tournamental.com — skipping tunnel update"
else
  jq '.result.config.ingress as $cur
      | .result.config.ingress = [
          {hostname:"play.tournamental.com", service:"http://localhost:3300"}
        ] + $cur' /tmp/cf-cur-play.json > /tmp/cf-new-play.json

  echo "Patching tunnel ingress..."
  curl -s -X PUT "$CFG_URL" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data "{\"config\": $(jq .result.config /tmp/cf-new-play.json)}" \
    | jq '{success, errors}'
fi

# DNS CNAME play.tournamental.com -> $TUNNEL_ID.cfargotunnel.com (proxied).
HAS_DNS=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?name=play.tournamental.com" \
  | jq -r '.result[0].id // empty')

if [ -n "$HAS_DNS" ]; then
  echo "DNS record for play.tournamental.com already exists (id $HAS_DNS) — skipping"
else
  echo "Creating CNAME play.tournamental.com -> $TUNNEL_ID.cfargotunnel.com..."
  curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"CNAME\",\"name\":\"play\",\"content\":\"$TUNNEL_ID.cfargotunnel.com\",\"proxied\":true}" \
    | jq '{success, errors, name: .result.name}'
fi

echo
echo "DONE. Smoke test: curl -I https://play.tournamental.com"
