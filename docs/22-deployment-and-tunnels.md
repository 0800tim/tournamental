# 22, Deployment, environments, and tunnels

> Where Tournamental runs, what URLs it serves, what ports back them, and how dev / staging / production differ. Read this if you're touching infrastructure, adding a service, or need to know which URL to point a client at.

## Three environments

| Env         | Purpose                                                    | DNS owner          | Hosting target                                       |
| ----------- | ---------------------------------------------------------- | ------------------ | ---------------------------------------------------- |
| **dev**     | Day-to-day development on a maintainer's dev server.       | Maintainer's private dev domain (not committed) | The maintainer's dev box, exposed via a Cloudflare tunnel on a private dev domain |
| **staging** | Pre-production validation against real-world conditions.   | Cloudflare tournamental.com | A staging box exposed via a `*-dev.tournamental.com` Cloudflare tunnel |
| **prod**    | Public site. Users live here.                              | Cloudflare tournamental.com | Cloudflare Pages (marketing) + dedicated app/API hosts |

**Rule**: a deploy goes `dev → staging → prod`. Never push code straight from local to prod. Staging exists to catch the "works on dev, broken in CDN" class of issue.

## URL plan

Maintainers run dev on whatever local hostname their Cloudflare tunnel is configured for (commonly a private development domain). For staging we use the `*-dev.tournamental.com` family, and prod is the public hostname. Each maintainer's dev hosts are not committed to the repo.

| Component        | Dev (local tunnel example)                      | Staging                                     | Prod (launch)            |
| ---------------- | ----------------------------------------------- | ------------------------------------------- | ------------------------ |
| Marketing site   | `<dev>` → `:3320`                              | `preview.tournamental.com`                  | `tournamental.com`              |
| App (renderer)   | `<dev>` → `:3300`                              | `dev.tournamental.com`                      | `play.tournamental.com`         |
| Match stream WS  | `<dev>` → `:4001`                              | (folded into app, `wss://dev.tournamental.com/ws`)  | `wss://play.tournamental.com/ws` |
| Stream fan-out   | `<dev>` → `:4002`                              | `stream-dev.tournamental.com`               | `stream.tournamental.com`       |
| API              | `<dev>` → `:3310`                              | `api-dev.tournamental.com`                  | `api.tournamental.com`          |
| Auth (SMS / WA)  | `<dev>` → `:3330`                              | `auth-dev.tournamental.com`                 | `auth.tournamental.com`         |
| DM-OTP login     | `<dev>` → `:3331`                              | `dm-dev.tournamental.com`                   | `dm.tournamental.com`           |
| Admin console    | `<dev>` → `:3340`                              | `admin-dev.tournamental.com`                | `admin.tournamental.com`        |
| Live odds ingest | `<dev>` → `:3341`                              | `odds-dev.tournamental.com`                 | `odds.tournamental.com`         |
| Game service    | `<dev>` → `:3360`                              | `game-dev.tournamental.com`                 | `game.tournamental.com`         |
| Affiliate router | `<dev>` → `:3370`                              | `aff-dev.tournamental.com`                  | `aff.tournamental.com`          |
| VStamp receipts  | `<dev>` → `:3390`                              | `vstamp-dev.tournamental.com`               | `vstamp.tournamental.com`       |
| Clip pipeline    | `<dev>` → `:3380`                              | `clip-dev.tournamental.com`                 | `clip.tournamental.com`         |
| MCP server       | `<dev>` → `:3395`                              | `mcp-dev.tournamental.com`                  | `mcp.tournamental.com`          |

The marketing site sits on a different host because it's mostly static and edge-cacheable; mixing it with the app would either over-cache the app's HTML or under-cache the marketing pages.

The match-stream WebSocket gets its own dev hostname so Cloudflare's Tunnel cleanly proxies the upgrade. In staging and prod we fold it into the app's origin and route via path (`/ws`), the dev split exists only because the producer is a separate process during development.

## Port assignments (dev)

This is the single source of truth. **Update this file in the same PR as any port change.** All ports are in the 3300/4001 ranges to avoid clawdia's allocations (3001, 8888, 9201–9274, etc.) and Tim's other client work.

| Service                    | Port  | Prod hostname                                          | Notes                                                                                |
| -------------------------- | ----- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `apps/web` (renderer)      | 3300  | `play.tournamental.com`                                | Next.js dev. `pnpm dev -- -p 3300`.                                                  |
| `apps/statsbomb-replay`    | 4001  | (folded into `play.tournamental.com/ws` in prod)       | WebSocket for the AR-FR producer per docs/11.                                        |
| `apps/mock-producer`       | 4001 (default) | n/a                                              | Same default as statsbomb-replay; only one producer runs at a time during dev. Override with `--port` if running both. |
| `apps/stream-server`       | 4002  | `stream.tournamental.com`                              | Fan-out WS + admin REST. Subscribes to one or more producers (default `ws://localhost:4001`) and fans out per-match streams to many subscribers on `/v1/match/:match_id`. See [`apps/stream-server/README.md`](../apps/stream-server/README.md). |
| `apps/api`                 | 3310  | `api.tournamental.com`                                 | Fastify.                                                                             |
| `apps/marketing` (future)  | 3320  | `tournamental.com`                                     | Next.js or Astro.                                                                    |
| `apps/auth-sms`            | 3330  | `auth.tournamental.com`                                | Fastify (SMS / WhatsApp OTP). See [docs/32](32-auth-and-privacy.md).                 |
| `apps/dm-otp`              | 3331  | `dm-otp.tournamental.com`                              | Fastify (DM-OTP login across 16 channels: Telegram, WhatsApp, Messenger, Instagram, Discord, X, Reddit, Threads, Slack, Mastodon, LINE, Viber, Teams, LinkedIn, Signal, Email magic-link). |
| `apps/admin`               | 3340  | `admin.tournamental.com`                               | Internal admin console (Next.js).                                                    |
| `apps/odds-ingest`         | 3341  | `odds.tournamental.com`                                | Fastify (Polymarket + The Odds API).                                                 |
| `apps/game`                | 3360  | `game.tournamental.com`                                | Fastify (bracket submission, match settlement, leaderboards). See [docs/12](12-odds-and-predictions.md). |
| `apps/affiliate-router`    | 3370  | `aff.tournamental.com`                                 | Fastify (geo-gated affiliate click resolver + audit log per docs/30).                |
| `apps/vstamp`              | 3390  | `vstamp.tournamental.com`                              | Fastify (Merkle-signed prediction receipts; doc 17).                                 |
| `apps/clip-pipeline`       | 3380  | `clip.tournamental.com`                                | Fastify + ffmpeg clip render service (per docs/14).                                  |
| `apps/mcp`                 | 3395  | `mcp.tournamental.com`                                 | Fastify + MCP Streamable HTTP. Model Context Protocol server exposing the tournament API to AI agents (Claude Desktop, Cursor, Windsurf, Continue). See [docs/53](53-mcp-server.md).      |
| `apps/news-aggregator`     | 3402  | `news.tournamental.com`                                | Fastify RSS news poller across BBC / Guardian / ESPN / Marca / FIFA / Goal (per docs/49). |
| Postgres (dev DB)          | 5435  | n/a                                                    | Docker container. Avoid clashing with clawdia (5433).                                |
| Redis (dev cache)          | 6380  | n/a                                                    | Docker container. Avoid clashing with clawdia (6379).                                |

Production maps to the same internal ports inside the container; the public ports are 80/443 fronted by Cloudflare.

## Cloudflare Tunnel (dev)

Each maintainer runs their own Cloudflare Tunnel pointing at their dev box. The tunnel name, ID, account ID, and hostname family are private to the maintainer and live in their local `.env` / Cloudflare account, not in this repo.

> **If your tunnel is "remote-managed",** the local `/etc/cloudflared/config.yml` is NOT the source of truth: the tunnel pulls its ingress from Cloudflare's Zero Trust dashboard / API on every reconnect. Local config edits and `systemctl restart` will NOT change which hostnames route to which services. Use the API procedure below.

### Add or change a dev hostname (API-driven, for a remote-managed tunnel)

```bash
# Bring credentials into scope (each maintainer manages these locally).
source ~/.cloudflared/cf-api-token        # CLOUDFLARE_API_TOKEN
ACCOUNT_ID=<your-cloudflare-account-id>
TUNNEL_ID=<your-tunnel-id>
HOST=newthing.<your-dev-domain>
PORT=3340

# 1. Create the CNAME record (DNS side, this works locally even though
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
curl -sI https://<new-host> | head -3
```

`HTTP/2 404` with `cf-cache-status: DYNAMIC` *and your service not yet bound* is healthy, Cloudflare reached the tunnel and the local service didn't answer. Once your service is listening, you should get its real response.

If the response is `HTTP/2 530` or `error 1033`, the **DNS** half is missing, re-run `cloudflared tunnel route dns ...`.

## Cloudflare Tunnel (staging + prod)

For the `tournamental.com` zone, run a **dedicated tunnel** so it has its own credentials. Suggested name: `tournamental-prod` (and `tournamental-staging` if a separate machine is used).

```bash
# On the host that will run the tunnel:
cloudflared tunnel login                 # one-time browser auth
cloudflared tunnel create tournamental-staging
cloudflared tunnel route dns tournamental-staging dev.tournamental.com
cloudflared tunnel route dns tournamental-staging preview.tournamental.com
cloudflared tunnel route dns tournamental-staging api-dev.tournamental.com
# Then write /etc/cloudflared/config.yml with these ingress rules
sudo systemctl enable --now cloudflared
```

Production replaces `staging` with `prod` and the dev hostnames with `tournamental.com`, `play.tournamental.com`, `api.tournamental.com`. The marketing site `tournamental.com` ideally lives on Cloudflare Pages (no tunnel needed); only the app + API need a tunnel/origin.

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
| Marketing static (`tournamental.com`)          | Edge cache 24h; `Cache-Control: public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800` | Mostly-static; rarely changes; SWR keeps perceived perf high during deploys. |
| Renderer HTML (`app.tournamental.com/match/*`) | `Cache-Control: no-store` for HTML; `Cache-Control: public, max-age=31536000, immutable` for hashed assets | HTML is per-user/per-match; assets are content-addressed. |
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

- TTFB on `app.tournamental.com/match/*`: < 200ms p95 (cached origin) / < 600ms cold.
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

## Pre-launch checklist

In addition to the full security pass in [doc 33](33-security-hardening-checklist.md), the operator runs these infra-side steps before each public launch:

- [ ] DNS records for every prod hostname in the URL plan exist and resolve.
- [ ] Cloudflare Tunnel ingress in prod covers every prod hostname (game, auth, dm-otp, etc.) and the local PM2 / systemd processes are listening on the documented ports.
- [ ] Edge cache rules match the caching strategy table above.
- [ ] **OTP brute-force WAF rules applied**: run `bash infra/cloudflare/otp-protection.sh --dry-run` to preview, then re-run without `--dry-run`. The script is idempotent (rules keyed by stable description) and pairs with `otp-protection-revert.sh` for rollback. See [doc 33 § OTP brute-force protection](33-security-hardening-checklist.md#otp-brute-force-protection-defence-in-depth) for the threshold rationale.
- [ ] Smoke-test: `curl -i https://tournamental.com/health` and the per-app `/health` endpoints all return 200.
- [ ] `pnpm typecheck && pnpm test` green at `main` head; PR backlog clean of `Needs revert`.

Failed items become tickets in `tasks/in-progress/` with an owner and ETA; the launch is not green-lit until they clear.
