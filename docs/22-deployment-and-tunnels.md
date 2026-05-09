# 22 — Deployment, environments, and tunnels

> Where VTorn runs, what URLs it serves, what ports back them, and how dev / staging / production differ. Read this if you're touching infrastructure, adding a service, or need to know which URL to point a client at.

## Three environments

| Env         | Purpose                                                    | DNS owner          | Hosting target                                       |
| ----------- | ---------------------------------------------------------- | ------------------ | ---------------------------------------------------- |
| **dev**     | Day-to-day development on Tim's dev server (this machine). | Cloudflare aiva.nz | This server, exposed via the existing aiva.nz tunnel |
| **staging** | Pre-production validation against real-world conditions.   | Cloudflare vtorn.com | This server (initially), then a dedicated staging box |
| **prod**    | Public site. Users live here.                              | Cloudflare vtorn.com | Cloudflare Pages (marketing) + dedicated app/API hosts |

**Rule**: a deploy goes `dev → staging → prod`. Never push code straight from local to prod. Staging exists to catch the "works on dev, broken in CDN" class of issue.

## URL plan

| Component        | Dev (today)                                     | Staging (next sprint)                       | Prod (launch)            |
| ---------------- | ----------------------------------------------- | ------------------------------------------- | ------------------------ |
| Marketing site   | `vtorn-www.aiva.nz` → `:3320`                   | `preview.vtorn.com`                          | `vtorn.com`              |
| App (renderer)   | `vtorn.aiva.nz` → `:3300`                       | `dev.vtorn.com`                              | `app.vtorn.com`          |
| Match stream WS  | `vtorn-stream.aiva.nz` → `:4001`                | (folded into app, `wss://dev.vtorn.com/ws`)  | `wss://app.vtorn.com/ws` |
| API              | `vtorn-api.aiva.nz` → `:3310`                   | `api-dev.vtorn.com`                          | `api.vtorn.com`          |

The marketing site sits on a different host because it's mostly static and edge-cacheable; mixing it with the app would either over-cache the app's HTML or under-cache the marketing pages.

The match-stream WebSocket gets its own dev hostname so Cloudflare's Tunnel cleanly proxies the upgrade. In staging and prod we fold it into the app's origin and route via path (`/ws`) — the dev split exists only because the producer is a separate process during development.

## Port assignments (dev)

This is the single source of truth. **Update this file in the same PR as any port change.** All ports are in the 3300/4001 ranges to avoid clawdia's allocations (3001, 8888, 9201–9274, etc.) and Tim's other client work.

| Service                    | Port  | Notes                                                                                |
| -------------------------- | ----- | ------------------------------------------------------------------------------------ |
| `apps/web` (renderer)      | 3300  | Next.js dev. `pnpm dev -- -p 3300`. Tunnel: `vtorn.aiva.nz`.                        |
| `apps/statsbomb-replay`    | 4001  | WebSocket for the AR-FR producer per docs/11. Tunnel: `vtorn-stream.aiva.nz`.       |
| `apps/mock-producer`       | 4001 (default) | Same default as statsbomb-replay; only one producer runs at a time during dev. Override with `--port` if running both. |
| `apps/api`                 | 3310  | Fastify. Tunnel: `vtorn-api.aiva.nz`.                                                |
| `apps/marketing` (future)  | 3320  | Next.js or Astro. Tunnel: `vtorn-www.aiva.nz`.                                       |
| Postgres (dev DB)          | 5435  | Docker container. Avoid clashing with clawdia (5433).                                |
| Redis (dev cache)          | 6380  | Docker container. Avoid clashing with clawdia (6379).                                |

Production maps to the same internal ports inside the container; the public ports are 80/443 fronted by Cloudflare.

## Cloudflare Tunnel (dev)

The aiva.nz tunnel is the existing tunnel `68c2f5b4-8713-441b-9de5-1933557a443b` running on this server (managed via systemd `cloudflared.service`). Per `clawdia/CLAUDE.md`, **don't modify ports or ingress for other services**. Adding new ingress for vtorn-* is fine.

Add a new vtorn dev hostname:

```bash
# 1. Add a CNAME record in Cloudflare (the tunnel CLI does this)
cloudflared tunnel route dns 68c2f5b4-8713-441b-9de5-1933557a443b <new-host>.aiva.nz

# 2. Add an ingress rule to /etc/cloudflared/config.yml BEFORE the
#    catch-all. Group with existing # --- VTorn (dev) --- block.
sudo $EDITOR /etc/cloudflared/config.yml

# 3. Restart cloudflared (reload is unsupported on this build).
sudo systemctl restart cloudflared
sudo systemctl is-active cloudflared
```

Smoke test:

```bash
curl -sI https://<new-host>.aiva.nz | head -3
```

`HTTP/2 404` with `cf-cache-status: DYNAMIC` is healthy — it means Cloudflare reached the tunnel and the local service didn't answer (because it isn't running yet, or because that path 404s).

## Cloudflare Tunnel (staging + prod)

When `vtorn.com` is in Cloudflare under Tim's account, set up a **separate tunnel for vtorn.com** so it has its own credentials and isn't entangled with aiva.nz. Suggested name: `vtorn-prod` (and `vtorn-staging` if a separate machine is used).

```bash
# On the host that will run the tunnel:
cloudflared tunnel login                 # one-time browser auth
cloudflared tunnel create vtorn-staging
cloudflared tunnel route dns vtorn-staging dev.vtorn.com
cloudflared tunnel route dns vtorn-staging preview.vtorn.com
cloudflared tunnel route dns vtorn-staging api-dev.vtorn.com
# Then write /etc/cloudflared/config.yml with these ingress rules
sudo systemctl enable --now cloudflared
```

Production replaces `staging` with `prod` and the dev hostnames with `vtorn.com`, `app.vtorn.com`, `api.vtorn.com`. The marketing site `vtorn.com` ideally lives on Cloudflare Pages (no tunnel needed) — only the app + API need a tunnel/origin.

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
| Marketing static (`vtorn.com`)          | Edge cache 24h; `Cache-Control: public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800` | Mostly-static; rarely changes; SWR keeps perceived perf high during deploys. |
| Renderer HTML (`app.vtorn.com/match/*`) | `Cache-Control: no-store` for HTML; `Cache-Control: public, max-age=31536000, immutable` for hashed assets | HTML is per-user/per-match; assets are content-addressed. |
| Renderer WebSocket (`/ws`)             | Cloudflare-bypass; no caching ever                     | Live data. |
| API hot reads (`/v1/leaderboards/*`)   | Redis layer: 1s–10s TTL; Cache-Control: `public, max-age=5`. Edge cache 5s. | Highly contended; staleness-tolerant; Redis absorbs the bulk. |
| API user-specific (`/v1/me/*`)         | `Cache-Control: private, no-store`                     | PII. |
| API match-static (`/v1/matches/:id/odds`, etc.) | Edge cache 5m once finalised; SWR 1h. In-memory cache (LRU per process) for hottest IDs. | Doesn't change after match end. |
| Avatar/asset bundles (`apps/web/public/`) | `Cache-Control: public, max-age=31536000, immutable` | Hashed filenames; safe forever. |
| Player photo thumbs                    | Cloudflare Image Resizing; 30d edge; SWR 7d            | External source can be slow; we compute once. |

**Performance budgets** (enforced by Playwright + Lighthouse in CI eventually):

- TTFB on `app.vtorn.com/match/*`: < 200ms p95 (cached origin) / < 600ms cold.
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
