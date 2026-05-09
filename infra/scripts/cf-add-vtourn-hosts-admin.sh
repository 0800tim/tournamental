#!/usr/bin/env bash
# Add admin.vtourn.com to the existing aiva-tunnel via Cloudflare API.
# Sister script to cf-add-vtourn-hosts.sh — adds only the admin host.
# Idempotent: if the rule is already present we leave it alone.
set -euo pipefail
source /home/clawdbot/.cloudflared/cf-api-token  # CLOUDFLARE_API_TOKEN

ACCOUNT_ID=f08ad6bd468886c7d991a817b3bbbeba
TUNNEL_ID=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel" \
  | jq -r '.result[] | select(.name=="aiva-tunnel" or .name=="vtorn-tunnel") | .id' | head -1)
echo "Tunnel: $TUNNEL_ID"

ZONE_ID=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones?name=vtourn.com" | jq -r '.result[0].id')
[ "$ZONE_ID" = "null" ] && { echo "ERROR: vtourn.com zone not visible"; exit 1; }
echo "vtourn.com zone: $ZONE_ID"

curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" \
  > /tmp/cf-cur-admin.json

# Insert admin.vtourn.com -> :3340 if it isn't already in the ingress.
HAS_ADMIN=$(jq '.result.config.ingress[] | select(.hostname=="admin.vtourn.com")' /tmp/cf-cur-admin.json)
if [ -z "$HAS_ADMIN" ]; then
  jq '.result.config.ingress as $cur
      | .result.config.ingress = [
          {hostname:"admin.vtourn.com", service:"http://localhost:3340"}
        ] + $cur' /tmp/cf-cur-admin.json > /tmp/cf-new-admin.json

  curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data "{\"config\": $(jq .result.config /tmp/cf-new-admin.json)}" \
    | jq '.success, .errors'
else
  echo "admin.vtourn.com ingress already present"
fi

# Create CNAME admin.vtourn.com -> $TUNNEL_ID.cfargotunnel.com
TARGET="$TUNNEL_ID.cfargotunnel.com"
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{\"type\":\"CNAME\",\"name\":\"admin\",\"content\":\"$TARGET\",\"proxied\":true}" \
  | jq -r '.success, .errors[]?.message' || true

echo "DONE — test: curl -I https://admin.vtourn.com"
