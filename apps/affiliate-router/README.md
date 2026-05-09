# `@vtorn/affiliate-router`

Fastify service on `:3370` that resolves affiliate clicks for the bracket page,
the WC marketing site, and the live-match second-screen. Geo-gates by
`cf-ipcountry`, applies per-IP and per-(user, partner) caps, writes an audit
log, and 302s the user to the partner with our affiliate code attached.

Companion docs:
- [docs/30-gamification-and-affiliate-spine.md](../../docs/30-gamification-and-affiliate-spine.md)
- [docs/18-monetization.md](../../docs/18-monetization.md)
- [docs/22-deployment-and-tunnels.md](../../docs/22-deployment-and-tunnels.md)
  for the canonical port/tunnel table (this service is `:3370`,
  `vtorn-aff.aiva.nz` in dev, `aff.vtourn.com` in prod).

## Quick start

```bash
pnpm --filter @vtorn/affiliate-router dev
# server boots on :3370 with the bundled placeholder partner codes
```

```bash
# 1. Healthcheck
curl -s http://localhost:3370/healthz | jq
# → { "ok": true, "service": "@vtorn/affiliate-router", "partners_loaded": 5, ... }

# 2. List partners for an NZ visitor (Polymarket is hidden, Sky NZ shows up)
curl -s 'http://localhost:3370/v1/affiliate/partners?country=NZ' | jq

# 3. Resolve a Polymarket click for a US visitor
curl -sI 'http://localhost:3370/v1/affiliate/click?partner=polymarket&surface=bracket&user_id=u-123&match_id=arg-fra&team_code=ARG' \
  -H 'cf-ipcountry: US'
# → 302 Location: https://polymarket.com/?ref=AFFCODE_PLACEHOLDER_polymarket&vt_surface=bracket&vt_match=arg-fra&vt_team=ARG

# 4. NZ visitor blocked from Polymarket
curl -s 'http://localhost:3370/v1/affiliate/click?partner=polymarket&surface=bracket' \
  -H 'cf-ipcountry: NZ' | jq
# → { "reason": "geo_excluded", "country": "NZ", "partner": "polymarket" }
```

## Endpoints

### `GET /v1/affiliate/click`

Query params:

| name          | required | example                  | notes |
|---------------|----------|--------------------------|-------|
| `partner`     | yes      | `polymarket`             | kebab-case lowercase |
| `surface`     | yes      | `bracket` \| `match` \| `marketing` | analytics surface |
| `match_id`    | no       | `arg-fra-2026`           | passed through as `vt_match` |
| `team_code`   | no       | `ARG`                    | 3-letter ISO-3166 alpha-3-style team code |
| `user_id`     | no       | `u_abc123`               | hashed before storage; never logged raw |
| `campaign_id` | no       | `wc26-bracket-cta-a`     | passed through as `vt_campaign` |
| `country`     | no       | `US`                     | dev override; production uses `cf-ipcountry` |

Responses:
- `302` — redirect to partner URL with affiliate ref + `vt_*` sub-IDs.
- `400` — invalid params.
- `404 partner_not_found` — partner id unknown.
- `404 geo_excluded` — partner not allowed in resolved country
  (NZ + Polymarket is the load-bearing case here).
- `422 country_unresolved` — neither `cf-ipcountry` nor `?country=` produced a
  valid ISO-3166 alpha-2.
- `429 rate_limited` — per-(user, partner) 24h cap (3 clicks) or per-IP 30/min
  cap exceeded.

### `GET /v1/affiliate/partners?country=NZ`

Returns the partners available in the resolved country, with display fields
the frontend can render in `<AffiliateCTA>`. Affiliate codes are NEVER in the
response.

```json
{
  "country": "NZ",
  "partners": [
    {
      "id": "sky-nz",
      "name": "Sky Sport NZ",
      "kind": "paytv-stream",
      "offer_text": "Watch every World Cup match live. 4-week tournament pass NZ$14.99.",
      "logo_url": "https://cdn.vtourn.com/partners/sky-nz.svg"
    }
  ]
}
```

Edge-cacheable: `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=3600`.

### `GET /healthz`

```json
{ "ok": true, "service": "@vtorn/affiliate-router", "partners_loaded": 5, "ts": "..." }
```

`Cache-Control: no-store`.

## Geo-gating rules

1. Country resolution: `cf-ipcountry` header (Cloudflare-injected) wins;
   `?country=` is the dev fallback. CF placeholder codes (`XX`, `T1`) count as
   unknown.
2. Each partner declares `allowed_countries` (ISO-3166 alpha-2). The router
   only resolves a click if the partner allows that country.
3. **Hard rule (defence in depth)**: NZ users MUST NOT receive Polymarket
   links. Enforced both via the partner's `allowed_countries` list and a
   separate code-level `nzPolymarketExclusion` check, so a misedit of
   `partners.json` cannot accidentally open the gate.

## Throttling

- **Per-IP**: 30 clicks / minute, via `@fastify/rate-limit`. Key is
  `cf-connecting-ip` (Cloudflare) or `req.ip` (dev). Cap configurable via
  `AFFILIATE_RATE_LIMIT_MAX`.
- **Per-(user, partner)**: 3 clicks / 24h, enforced against the SQLite click
  log. Anonymous (no `user_id`) calls bypass this cap — the per-IP cap still
  applies. See docs/33 § D bot abuse.

## Audit log

SQLite, default `apps/affiliate-router/data/clicks.db` (override via
`AFFILIATE_DB_PATH`):

```sql
CREATE TABLE clicks (
  id TEXT PRIMARY KEY,
  partner TEXT NOT NULL,
  surface TEXT NOT NULL,
  country TEXT NOT NULL,
  match_id TEXT,
  team_code TEXT,
  user_id_hash TEXT,
  campaign_id TEXT,
  ts INTEGER NOT NULL
);
```

`user_id_hash` is `SHA-256(user_id + AFFILIATE_USER_HASH_SALT)`. The raw
`user_id` is never persisted and never logged.

## Environment variables

`.env.example` is the canonical reference. Tim sets the real values per
environment.

| key                                | required          | example                                  | notes |
|------------------------------------|-------------------|------------------------------------------|-------|
| `AFFILIATE_PORT`                   | no                | `3370`                                   | listen port |
| `AFFILIATE_BIND`                   | no                | `0.0.0.0`                                | bind host |
| `AFFILIATE_DB_PATH`                | no                | `./data/clicks.db`                       | SQLite path; `:memory:` for tests |
| `AFFILIATE_PARTNERS_PATH`          | no                | `./data/partners.json`                   | partner registry path override |
| `AFFILIATE_USER_HASH_SALT`         | **prod**          | `change-me-32-random-bytes-please`       | min 16 chars; rotating invalidates dedupe |
| `AFFILIATE_CORS_ORIGINS`           | no                | `https://vtourn.com,https://2026wc.vtourn.com` | csv |
| `AFFILIATE_RATE_LIMIT_MAX`         | no                | `30`                                     | per-IP per minute |
| `AFFCODE_POLYMARKET`               | prod              | (real Polymarket affiliate code)         | overrides JSON placeholder |
| `AFFCODE_BET365`                   | prod              | (real Bet365 affiliate code)             | overrides JSON placeholder |
| `AFFCODE_SKY_NZ`                   | prod              | (real Sky NZ partner ID)                 | overrides JSON placeholder |
| `AFFCODE_ESPN_PLUS`                | prod              | (real ESPN+ affiliate code)              | overrides JSON placeholder |
| `AFFCODE_DAZN`                     | prod              | (real DAZN promo code)                   | overrides JSON placeholder |
| `LOG_LEVEL`                        | no                | `info`                                   | pino level |
| `LOG_PRETTY`                       | no                | `1`                                      | dev only |

## Adding a new partner

1. Add an entry to `data/partners.json` (id kebab-case lowercase, valid
   ISO-3166 alpha-2 country codes, https URLs).
2. Set `AFFCODE_<ID_UPPER>` in `.env` once Tim has the real code from the
   provider's affiliate console.
3. The Zod schema in `src/partners.ts` validates the entry on boot —
   misformatted JSON crashes the service early.
4. Add a smoke test in `tests/click.test.ts` confirming a sample country sees
   the partner.

## Tests

```bash
pnpm --filter @vtorn/affiliate-router test
pnpm --filter @vtorn/affiliate-router typecheck
```

Coverage spans every endpoint, geo gating (NZ excluded for Polymarket,
country normalisation), partner-not-found, throttle behaviour (per-IP +
per-user-partner), audit-log writes, and hash determinism.

## Deployment

- Dev: `vtorn-aff.aiva.nz` → `:3370` via the existing aiva.nz Cloudflare
  Tunnel. See [docs/22-deployment-and-tunnels.md](../../docs/22-deployment-and-tunnels.md)
  for the API-driven ingress procedure.
- Prod: `aff.vtourn.com` → service container on the prod tunnel.

The clicks DB lives on local disk; for prod we mount a persistent volume and
mirror nightly via the existing `infra/scripts/db-backup.sh`.
