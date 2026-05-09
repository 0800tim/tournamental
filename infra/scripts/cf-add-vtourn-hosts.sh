#!/usr/bin/env bash
# Add vtourn.com hostnames to the existing aiva-tunnel via Cloudflare API.
# Prereq: token with Account.Cloudflare Tunnel:Edit + Zone.DNS:Edit on vtourn.com.
set -euo pipefail
source /home/clawdbot/.cloudflared/cf-api-token  # CLOUDFLARE_API_TOKEN

ACCOUNT_ID=f08ad6bd468886c7d991a817b3bbbeba   # may differ if vtourn.com is in another account
TUNNEL_ID=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel" \
  | jq -r '.result[] | select(.name=="aiva-tunnel" or .name=="vtorn-tunnel") | .id' | head -1)
echo "Tunnel: $TUNNEL_ID"

ZONE_ID=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones?name=vtourn.com" | jq -r '.result[0].id')
[ "$ZONE_ID" = "null" ] && { echo "ERROR: vtourn.com zone not visible — token needs vtourn.com scope"; exit 1; }
echo "vtourn.com zone: $ZONE_ID"

curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" \
  > /tmp/cf-cur.json

# Patch ingress to add vtourn hostnames pointing at the same local services
jq '.result.config.ingress as $cur
  | .result.config.ingress = [
      {hostname:"2026wc.vtourn.com", service:"http://localhost:3300"},
      {hostname:"app.vtourn.com",    service:"http://localhost:3300"},
      {hostname:"www.vtourn.com",    service:"http://localhost:4321"},
      {hostname:"vtourn.com",        service:"http://localhost:4321"},
      {hostname:"api.vtourn.com",    service:"http://localhost:3310"},
      {hostname:"stream.vtourn.com", service:"http://localhost:9300"}
    ] + $cur' /tmp/cf-cur.json > /tmp/cf-new.json

curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{\"config\": $(jq .result.config /tmp/cf-new.json)}" \
  | jq '.success, .errors'

# Create CNAME records on vtourn.com pointing each hostname at $TUNNEL_ID.cfargotunnel.com
for H in 2026wc app www vtourn api stream; do
  TARGET="$TUNNEL_ID.cfargotunnel.com"
  NAME=$([ "$H" = "vtourn" ] && echo "@" || echo "$H")
  curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"CNAME\",\"name\":\"$NAME\",\"content\":\"$TARGET\",\"proxied\":true}" \
    | jq -r '.success, .errors[]?.message' || true
done

echo "DONE — test: curl -I https://2026wc.vtourn.com"
