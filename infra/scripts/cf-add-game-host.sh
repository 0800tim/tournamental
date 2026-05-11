#!/usr/bin/env bash
# Add game.tournamental.com to the clawdbot-workstation tunnel via the
# Cloudflare API. Idempotent: re-running is a no-op once the ingress
# entry + DNS CNAME are in place.
#
# Why a dedicated host: game.tournamental.com is the @vtorn/game
# Fastify service on port 3360 (per docs/22). The web bracket UI
# calls game.tournamental.com/v1/picks/... directly from the browser,
# so the host needs its own CORS-friendly ingress instead of routing
# through the Next app on play.tournamental.com.
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

curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$CFG_URL" > /tmp/cf-cur-game.json

HAS_GAME=$(jq '.result.config.ingress[] | select(.hostname=="game.tournamental.com")' /tmp/cf-cur-game.json)
if [ -n "$HAS_GAME" ]; then
  echo "Ingress already has game.tournamental.com — skipping tunnel update"
else
  jq '.result.config.ingress as $cur
      | .result.config.ingress = [
          {hostname:"game.tournamental.com", service:"http://localhost:3360"}
        ] + $cur' /tmp/cf-cur-game.json > /tmp/cf-new-game.json

  echo "Patching tunnel ingress..."
  curl -s -X PUT "$CFG_URL" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data "{\"config\": $(jq .result.config /tmp/cf-new-game.json)}" \
    | jq '{success, errors}'
fi

# DNS CNAME game.tournamental.com -> $TUNNEL_ID.cfargotunnel.com (proxied).
HAS_DNS=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?name=game.tournamental.com" \
  | jq -r '.result[0].id // empty')

if [ -n "$HAS_DNS" ]; then
  echo "DNS record for game.tournamental.com already exists (id $HAS_DNS) — skipping"
else
  echo "Creating CNAME game.tournamental.com -> $TUNNEL_ID.cfargotunnel.com..."
  curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"CNAME\",\"name\":\"game\",\"content\":\"$TUNNEL_ID.cfargotunnel.com\",\"proxied\":true}" \
    | jq '{success, errors, name: .result.name}'
fi

echo
echo "DONE. Smoke test: curl https://game.tournamental.com/healthz"
