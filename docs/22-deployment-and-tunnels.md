# 22 — Deployment, environments, and tunnels

> Where VTourn runs, what URLs it serves, what ports back them, and how dev / staging / production differ. Read this if you're touching infrastructure, adding a service, or need to know which URL to point a client at.

## Three environments

| Env         | Purpose                                                    | DNS owner          | Hosting target                                       |
| ----------- | ---------------------------------------------------------- | ------------------ | ---------------------------------------------------- |
| **dev**     | Day-to-day development on Tim's dev server (this machine). | Cloudflare aiva.nz | This server, exposed via the existing aiva.nz tunnel |
| **staging** | Pre-production validation against real-world conditions.   | Cloudflare vtourn.com | This server (initially), then a dedicated staging box |
| **prod**    | Public site. Users live here.                              | Cloudflare vtourn.com | Cloudflare Pages (marketing) + dedicated app/API hosts |

**Rule**: a deploy goes `dev → staging → prod`. Never push code straight from local to prod. Staging exists to catch the "works on dev, broken in CDN" class of issue.

## URL plan

| Component        | Dev (today)                                     | Staging (next sprint)                       | Prod (launch)            |
| ---------------- | ----------------------------------------------- | ------------------------------------------- | ------------------------ |
| Marketing site   | `vtorn-www.aiva.nz` → `:3320`                   | `preview.vtourn.com`                          | `vtourn.com`              |
| App (renderer)   | `vtorn.aiva.nz` → `:3300`                       | `dev.vtourn.com`                              | `app.vtourn.com`          |
| Match stream WS  | `vtorn-stream.aiva.nz` → `:4001`                | (folded into app, `wss://dev.vtourn.com/ws`)  | `wss://app.vtourn.com/ws` |
| Stream fan-out   | `vtorn-stream-fanout.aiva.nz` → `:4002`         | `stream-dev.vtourn.com`                       | `stream.vtourn.com`       |
| API              | `vtorn-api.aiva.nz` → `:3310`                   | `api-dev.vtourn.com`                          | `api.vtourn.com`          |
| Auth (SMS / WA)  | `vtorn-auth.aiva.nz` → `:3330`                  | `auth-dev.vtourn.com`                         | `auth.vtourn.com`          |
| DM-OTP login     | `vtorn-dm-otp.aiva.nz` → `:3331`                | `dm-dev.vtourn.com`                           | `dm.vtourn.com`            |
| Admin console    | `vtorn-admin.aiva.nz` → `:3340`                 | `admin-dev.vtourn.com`                        | `admin.vtourn.com`        |
| Live odds ingest | `vtorn-odds.aiva.nz` → `:3341`                  | `odds-dev.vtourn.com`                         | `odds.vtourn.com`         |
| Game service     | `vtorn-game.aiva.nz` → `:3360`                  | `game-dev.vtourn.com`                         | `game.vtourn.com`         |
| Affiliate router | `vtorn-aff.aiva.nz` → `:3370`                   | `aff-dev.vtourn.com`                          | `aff.vtourn.com`          |
| VStamp receipts  | `vtorn-vstamp.aiva.nz` → `:3390`                | `vstamp-dev.vtourn.com`                       | `vstamp.vtourn.com`       |
| Clip pipeline    | `vtorn-clip.aiva.nz` → `:3380`                  | `clip-dev.vtourn.com`                         | `clip.vtourn.com`         |

The marketing site sits on a different host because it's mostly static and edge-cacheable; mixing it with the app would either over-cache the app's HTML or under-cache the marketing pages.

The match-stream WebSocket gets its own dev hostname so Cloudflare's Tunnel cleanly proxies the upgrade. In staging and prod we fold it into the app's origin and route via path (`/ws`) — the dev split exists only because the producer is a separate process during development.

## Port assignments (dev)

This is the single source of truth. **Update this file in the same PR as any port change.** All ports are in the 3300/4001 ranges to avoid clawdia's allocations (3001, 8888, 9201–9274, etc.) and Tim's other client work.

| Service                    | Port  | Notes                                                                                |
| -------------------------- | ----- | ------------------------------------------------------------------------------------ |
| `apps/web` (renderer)      | 3300  | Next.js dev. `pnpm dev -- -p 3300`. Tunnel: `vtorn.aiva.nz`.                        |
| `apps/statsbomb-replay`    | 4001  | WebSocket for the AR-FR producer per docs/11. Tunnel: `vtorn-stream.aiva.nz`.       |
| `apps/mock-producer`       | 4001 (default) | Same default as statsbomb-replay; only one producer runs at a time during dev. Override with `--port` if running both. |
| `apps/stream-server`       | 4002  | Fan-out WS + admin REST. Subscribes to one or more producers (default `ws://localhost:4001`) and fans out per-match streams to many subscribers on `/v1/match/:match_id`. Tunnel: `vtorn-stream-fanout.aiva.nz` (dev) / `stream.vtourn.com` (prod). See [`apps/stream-server/README.md`](../apps/stream-server/README.md). |
| `apps/api`                 | 3310  | Fastify. Tunnel: `vtorn-api.aiva.nz`.                                                |
| `apps/marketing` (future)  | 3320  | Next.js or Astro. Tunnel: `vtorn-www.aiva.nz`.                                       |
| `apps/auth-sms`            | 3330  | Fastify (SMS / WhatsApp OTP). Tunnel: `vtorn-auth.aiva.nz`. See [docs/32](32-auth-and-privacy.md). |
| `apps/dm-otp`              | 3331  | Fastify (DM-OTP login across 16 channels: Telegram, WhatsApp, Messenger, Instagram, Discord, X, Reddit, Threads, Slack, Mastodon, LINE, Viber, Teams, LinkedIn, Signal, Email magic-link). Tunnel: `vtorn-dm-otp.aiva.nz`. |
| `apps/admin`               | 3340  | Internal admin console (Next.js). Tunnel: `vtorn-admin.aiva.nz` / `admin.vtourn.com`. |
| `apps/odds-ingest`         | 3341  | Fastify (Polymarket + The Odds API). Tunnel: `vtorn-odds.aiva.nz` / `odds.vtourn.com`. |
| `apps/game`                | 3360  | Fastify (bracket submission, match settlement, leaderboards). Tunnel: `vtorn-game.aiva.nz` / `game.vtourn.com`. See [docs/12](12-odds-and-predictions.md). |
| `apps/affiliate-router`    | 3370  | Fastify (geo-gated affiliate click resolver + audit log per docs/30). Tunnel: `vtorn-aff.aiva.nz` / `aff.vtourn.com`. |
| `apps/vstamp`              | 3390  | Fastify (Merkle-signed prediction receipts; doc 17). Tunnel: `vtorn-vstamp.aiva.nz` / `vstamp.vtourn.com`. |
| `apps/clip-pipeline`       | 3380  | Fastify + ffmpeg clip render service (per docs/14). Tunnel: `vtorn-clip.aiva.nz`.   |
| `apps/news-aggregator`     | 3402  | Fastify RSS news poller across BBC / Guardian / ESPN / Marca / FIFA / Goal (per docs/49). Tunnel: `vtorn-news.aiva.nz` / `news.vtourn.com`. |
| Postgres (dev DB)          | 5435  | Docker container. Avoid clashing with clawdia (5433).                                |
| Redis (dev cache)          | 6380  | Docker container. Avoid clashing with clawdia (6379).                                |

Production maps to the same internal ports inside the container; the public ports are 80/443 fronted by Cloudflare.

## Cloudflare Tunnel (dev)

The aiva.nz tunnel is the existing tunnel `68c2f5b4-8713-441b-9de5-1933557a443b` running on this server (managed via systemd `cloudflared.service`). Per `clawdia/CLAUDE.md`, **don't modify ports or ingress for other services**. Adding new ingress for vtorn-* is fine.

> **The local `/etc/cloudflared/config.yml` is NOT the source of truth.** This tunnel pulls its ingress configuration from Cloudflare's Zero Trust dashboard / API on every reconnect. Local config edits and `systemctl restart` will NOT change which hostnames route to which services. Use the API procedure below.

### Add or change a vtorn dev hostname (API-driven)

```bash
# Bring credentials into scope
source /home/clawdbot/.cloudflared/cf-api-token        # CLOUDFLARE_API_TOKEN
ACCOUNT_ID=f08ad6bd468886c7d991a817b3bbbeba
TUNNEL_ID=68c2f5b4-8713-441b-9de5-1933557a443b
HOST=vtorn-newthing.aiva.nz
PORT=3340

# 1. Create the CNAME record (DNS side — this works locally even though
#    ingress is remote-managed).
cloudflared tunnel route dns "$TUNNEL_ID" "$HOST"

# 2. Pull current ingress, append the new rule before the catch-all,
#    PUT the merged config back.
curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" > /tmp/cf-cur.json

python3 <<PY > /tmp/cf-new.json
import json
cur = json.load(open('/tmp/cf-cur.json'))
cfg = cur['result']['config']
ingress = cfg['ingress']
catchall = ingress.pop()
ingress = [r for r in ingress if r.get('hostname') != "$HOST"]
ingress.append({'hostname': "$HOST", 'service': "http://localhost:$PORT"})
ingress.append(catchall)
cfg['ingress'] = ingress
print(json.dumps({'config': cfg}))
PY

curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data @/tmp/cf-new.json | python3 -c "import json,sys;d=json.load(sys.stdin);print('ok' if d['success'] else d['errors'])"

# 3. (Optional) mirror the change in the local config file as documentation.
sudo $EDITOR /etc/cloudflared/config.yml
```

Smoke test:

```bash
curl -sI https://<new-host>.aiva.nz | head -3
```

`HTTP/2 404` with `cf-cache-status: DYNAMIC` *and your service not yet bound* is healthy — Cloudflare reached the tunnel and the local service didn't answer. Once your service is listening, you should get its real response.

If the response is `HTTP/2 530` or `error 1033`, the **DNS** half is missing — re-run `cloudflared tunnel route dns ...`.

## Cloudflare Tunnel (staging + prod)

When `vtourn.com` is in Cloudflare under Tim's account, set up a **separate tunnel for vtourn.com** so it has its own credentials and isn't entangled with aiva.nz. Suggested name: `vtorn-prod` (and `vtorn-staging` if a separate machine is used).

```bash
# On the host that will run the tunnel:
cloudflared tunnel login                 # one-time browser auth
cloudflared tunnel create vtorn-staging
cloudflared tunnel route dns vtorn-staging dev.vtourn.com
cloudflared tunnel route dns vtorn-staging preview.vtourn.com
cloudflared tunnel route dns vtorn-staging api-dev.vtourn.com
# Then write /etc/cloudflared/config.yml with these ingress rules
sudo systemctl enable --now cloudflared
```

Production replaces `staging` with `prod` and the dev hostnames with `vtourn.com`, `app.vtourn.com`, `api.vtourn.com`. The marketing site `vtourn.com` ideally lives on Cloudflare Pages (no tunnel needed) — only the app + API need a tunnel/origin.

## Database snapshots (cross-env)

The backup script at `infra/scripts/db-backup.sh` produces compressed `pg_dump` snapshots in `/var/backups/vtorn/` (configurable). Snapshots are designed to be restorable into any environment, so:

- A nightly **prod-snapshot** can be loaded into **staging** for realistic-data testing.
- A staging snapshot can be loaded into **dev** for repro of a staging-only bug.
- Snapshots **never** go from a lower env to a higher one (don't pollute prod with dev fixtures).

Before loading prod data anywhere lower, the restore script `infra/scripts/db-restore.sh` runs a configurable PII-scrub pass (e.g. hash emails, blank phone numbers). The scrub config lives at `infra/db/pii-scrub.sql` and **must be kept in sync with the production schema**.

## Caching strategy

Every PR touching public surfaces is reviewed against this table.

| Surface                                | Cache policy                                           | Why |
| -------------------------------------- | ------------------------------------------------------ | --- |
| Marketing static (`vtourn.com`)          | Edge cache 24h; `Cache-Control: public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800` | Mostly-static; rarely changes; SWR keeps perceived perf high during deploys. |
| Renderer HTML (`app.vtourn.com/match/*`) | `Cache-Control: no-store` for HTML; `Cache-Control: public, max-age=31536000, immutable` for hashed assets | HTML is per-user/per-match; assets are content-addressed. |
| Renderer WebSocket (`/ws`)             | Cloudflare-bypass; no caching ever                     | Live data. |
| API hot reads (`/v1/leaderboards/*`)   | Redis layer: 1s–10s TTL; Cache-Control: `public, max-age=5`. Edge cache 5s. | Highly contended; staleness-tolerant; Redis absorbs the bulk. |
| API user-specific (`/v1/me/*`)         | `Cache-Control: private, no-store`                     | PII. |
| API match-static (`/v1/matches/:id/odds`, etc.) | Edge cache 5m once finalised; SWR 1h. In-memory cache (LRU per process) for hottest IDs. | Doesn't change after match end. |
| Avatar/asset bundles (`apps/web/public/`) | `Cache-Control: public, max-age=31536000, immutable` | Hashed filenames; safe forever. |
| Player photo thumbs                    | Cloudflare Image Resizing; 30d edge; SWR 7d            | External source can be slow; we compute once. |
| Affiliate click (`/v1/affiliate/click`) | `Cache-Control: no-store`                              | 302 redirect with per-user audit; never cache. |
| Affiliate partner list (`/v1/affiliate/partners`) | `public, max-age=60, s-maxage=300, stale-while-revalidate=3600` | Per-country list; rarely changes; SWR absorbs deploys. |
| Clip MP4s (`/v1/clip/:id/file`)        | `Cache-Control: public, max-age=31536000, immutable`   | clip_id is a SHA over the inputs, so the bytes are content-addressed. |
| Highlight reel (`/v1/match/:id/highlights`) | `public, s-maxage=30, stale-while-revalidate=120` | Detection is deterministic; a 30s edge cache absorbs the bracket-page hot path. |
| Bracket overlay deep-link (`/world-cup-2026?overlay=...`) | Same cache key as `/world-cup-2026` (CDN ignores query strings on this path); `Cache-Control: public, s-maxage=300, stale-while-revalidate=86400` | Per `docs/44-overlay-router-and-mobile-overlays.md` the overlay-server-shim is a small fixed addendum (~200 B). Splitting the cache by overlay would explode the key-space (team × match) for ~zero benefit; share-preview parity is achieved by the shim, which itself sits inside the cached HTML. |

**Performance budgets** (enforced by Playwright + Lighthouse in CI eventually):

- TTFB on `app.vtourn.com/match/*`: < 200ms p95 (cached origin) / < 600ms cold.
- LCP on the demo route: < 2.5s on a mid-range 2022 Android over 4G.
- Renderer steady-state: 60fps, 22 players + ball, with the pitch shadow on.
- WS lag (producer → renderer first-frame): < 250ms p95 from the same continent.

## Daily review (performance & caching)

The orchestrator and reviewer agent both check this on every PR:

1. Did this PR add a public surface? → Was a cache policy chosen? → Does it match the table above?
2. Did this PR add a hot read? → Is there a Redis (or in-memory LRU) layer in front?
3. Did this PR add a write? → Are read-after-write semantics documented?
4. Did this PR add a dependency? → Is its size justified? (`bundle-analyzer` for client code).
5. Did this PR slow a critical path? → Is the regression measured and justified, or fixed?

Tim's standing rule: **performance and caching are paramount**. A 5% perf regression with no clear win is a request-changes.
