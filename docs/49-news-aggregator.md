# 49. News aggregator

> Status: shipped 2026-05-11, behind agents A–P. Owner: news-aggregator builder agent.
>
> Code: `apps/news-aggregator/` (Fastify TS, port `:3402`).
> Public surfaces: `/news` on the marketing site, the `<NewsStrip>`
> on the bracket-app home feed.

## What this service does

Polls a small list of public football-news RSS feeds every 10 minutes,
normalises each item to a common shape, deduplicates by canonical URL,
and exposes a small JSON API consumed by the marketing site
(`tournamental.com/news`) and the bracket app (`apps/web` home feed).

It is deliberately small. It does **not**:

- Cache full article bodies — only title, capped 1–2 sentence summary,
  optional thumbnail, and a link out to the publisher.
- Mirror or reformat publisher imagery beyond the thumbnail the feed
  itself provides via `media:thumbnail` / `media:content` / enclosure.
- Track per-user reads or analytics.

## Source list

We poll the following sources. Every entry shows: source ID, language,
default-enabled state, RSS endpoint, and the licensing posture we rely
on.

| ID            | Source         | Lang | Default  | Feed URL                                                | Licensing posture                                                                                                                                                                       |
| ------------- | -------------- | ---- | -------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bbc`         | BBC Sport      | en   | enabled  | `https://feeds.bbci.co.uk/sport/football/rss.xml`       | BBC publishes RSS for syndication and explicitly permits third-party readers to display the headline + brief summary, provided the link points back to the original article.            |
| `theguardian` | The Guardian   | en   | enabled  | `https://www.theguardian.com/football/rss`              | Guardian's syndication policy permits non-commercial reuse of headlines + brief summaries with attribution and a link back. We display attribution + outbound link on every card.       |
| `espn`        | ESPN           | en   | enabled  | `https://www.espn.com/espn/rss/soccer/news`             | ESPN's syndication FAQ permits headline + excerpt display with link-out. Same shape as our cards.                                                                                       |
| `marca`       | Marca          | es   | enabled  | `https://e00-marca.uecdn.es/rss/futbol.xml`             | Marca syndicates open RSS feeds; we surface only title + summary + link-out, the shape they encourage. Spanish-language coverage adds South-American + La Liga depth.                   |
| `fifa`        | FIFA           | en   | disabled | `https://www.fifa.com/rss/news.xml` (placeholder)        | FIFA does not currently publish a stable public RSS feed. Source registered disabled-by-default; flip `NEWS_ENABLE_FIFA=1` once a confirmed feed URL or syndication partnership lands.   |
| `goal`        | Goal.com       | en   | disabled | `https://www.goal.com/feeds/en/news` (placeholder)       | Goal.com's robots.txt is restrictive on programmatic access; we don't have a syndication agreement. Disabled by default; flip `NEWS_ENABLE_GOAL=1` only when a partnership is in place. |

The `enabled` flag lives in each source's descriptor in
`apps/news-aggregator/src/sources/<id>.ts`. The `/v1/sources` endpoint
returns every configured source so the UI can show "coming soon"
states even for disabled rows.

## Polling cadence and rate limit

- Default refresh interval: **10 minutes** (`NEWS_REFRESH_INTERVAL_MIN`).
- Per-source HTTP timeout: **12 s** (no retry; we'll catch up on the
  next tick).
- One in-flight tick at a time; if a previous tick is still running,
  the next tick is dropped (prevents hammering on slow upstreams).
- User-Agent header identifies us:
  `TournamentalNewsAggregator/0.1 (+https://github.com/0800tim/tournamental; polite RSS poller, ~6 reqs / 10 min)`
- We honour HTTP 304 / cache headers from upstreams when present (the
  `rss-parser` library handles ETag / Last-Modified for us).

That works out to roughly **~36 requests per source per hour, or ~864
per day** at peak — comfortably below the unmetered/abuse threshold
for any of the configured publishers.

## Data shape

Every source normalises to a single `NewsItem`:

```ts
interface NewsItem {
  id: string;            // stable hash of (sourceId, canonical-url)
  title: string;         // HTML stripped, single line
  summary: string;       // HTML stripped, capped at 240 chars
  url: string;           // canonical URL with utm_* removed
  source: string;        // displayName ("BBC Sport", "The Guardian", ...)
  sourceLogo?: string;   // optional URL the UI can render as a small mark
  publishedAt: string;   // ISO-8601 UTC
  language: string;      // ISO 639-1 ("en", "es", ...)
  tags: string[];        // ["football", "wc2026", "team:argentina"]
  imageUrl?: string;     // thumbnail from media:thumbnail / media:content / enclosure
  imageCredit?: string;  // optional photo credit (rare; reserved for future)
}
```

The schema is enforced by Zod in `src/types.ts`.

## API endpoints

All endpoints live on the `:3402` service under `/v1/`:

| Method | Path                    | Description                                                                              |
| ------ | ----------------------- | ---------------------------------------------------------------------------------------- |
| GET    | `/healthz`              | Liveness probe. Always 200.                                                              |
| GET    | `/v1/version`           | Service name + version + env.                                                            |
| GET    | `/v1/news`              | Paginated list (`limit`, `since`, `source`, `lang`, `tag`). Defaults: `limit=20`, `lang=en`. |
| GET    | `/v1/news/:id`          | One item by stable id.                                                                   |
| GET    | `/v1/sources`           | Source list with health (lastFetch, errorCount, itemCount).                              |
| POST   | `/v1/admin/refresh`     | Force-refresh now. Bearer-gated by `NEWS_ADMIN_SECRET`.                                  |

Cache headers:

- `/v1/news` — `Cache-Control: public, s-maxage=120, stale-while-revalidate=600`. ETag is `W/"<latestPublishedAt>-<count>-<limit>"`; if the client sends `If-None-Match` with a matching value we return `304`.
- `/v1/news/:id` — `s-maxage=300, stale-while-revalidate=1200`.
- `/v1/sources` — `max-age=60`.
- `/healthz` — `no-store`.

## How `/news` and the home strip consume it

- **Marketing site** (`apps/marketing/src/pages/news/index.astro`) reads `NEWS_AGG_URL` at build time, inlines the first batch into the page, and ships a small client-side script that calls `/api/news` (an Astro endpoint that proxies to the same service) for chip-filtering and "load more" pagination.
- **Bracket app** (`apps/web/components/home/NewsStrip.tsx`) is rendered only on the home feed (not `/world-cup-2026`) and fetches client-side from `/api/news` (a Next route handler proxying to `:3402`).
- **Production**: when the marketing site is hosted on Cloudflare Pages, the `/api/news` Astro endpoint becomes a Pages Function (or a static fallback that's pre-rendered at build time and refreshed by the client). The home-page `NewsStrip` runs on Next so its `/api/news` route handler is server-side at runtime.

Both surfaces gracefully render an empty state on upstream failure rather than a 5xx error.

## Source ethics — link-out, not rehost

This is non-negotiable. For every source we display:

1. **Title** (HTML stripped).
2. **A 1–2 sentence summary**, paraphrased from the RSS `description` and capped at 240 characters. We never store or render the full article body.
3. **Source name + logo** — small, non-prominent, attribution-only.
4. **Publish time**, relative ("2 h ago") with the absolute time in a tooltip.
5. **An outbound link** to the original article with `target="_blank"` and `rel="noopener nofollow"`.

We do **not** display:

- Full article text.
- The source's branded artwork unless the RSS feed itself surfaces a thumbnail (`media:thumbnail` / `media:content` / `enclosure`). When the feed doesn't provide a thumbnail, we render a source-coloured gradient placeholder.
- Inline source styling, fonts, or other branded elements.

If a source's terms ever change to forbid even title-and-summary syndication, we remove the source. The `/v1/sources` health snapshot makes it trivial to flip a source off in one PR.

## How to add a new source

1. Drop a new file in `apps/news-aggregator/src/sources/<id>.ts` exporting a `descriptor: SourceDescriptor`.
2. Confirm:
   - The source publishes a public RSS or Atom feed.
   - The source's robots.txt and syndication terms permit third-party display of headline + summary with link-out (or document the ambiguity and ship `enabled: false`).
3. Register it in `apps/news-aggregator/src/sources/index.ts` (append to `ALL_SOURCES`).
4. Add a fixture XML at `apps/news-aggregator/tests/fixtures/<id>.xml` and at least one parse-the-fixture test in `tests/fetcher.test.ts`.
5. Update the source table at the top of this doc.

## Configuration

| Env                              | Default                                                                                                | Notes                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `NEWS_AGG_PORT`                  | `3402`                                                                                                 | Listen port.                                                                           |
| `NEWS_AGG_BIND`                  | `0.0.0.0`                                                                                              | Bind address.                                                                          |
| `NEWS_REFRESH_INTERVAL_MIN`      | `10`                                                                                                   | Scheduler tick.                                                                        |
| `NEWS_CACHE_PATH`                | `data/news-cache.jsonl`                                                                                | Append-only on-disk cache (gitignored).                                                |
| `NEWS_RETENTION_DAYS`            | `30`                                                                                                   | Drop items older than this on load + on insert.                                        |
| `NEWS_ADMIN_SECRET`              | unset                                                                                                  | Bearer for `POST /v1/admin/refresh`. When unset, that endpoint returns 503.            |
| `NEWS_AGG_CORS_ORIGINS`          | comma-separated allow-list (defaults cover `tournamental.com`, `vtorn-www.aiva.nz`, `vtorn.aiva.nz`, dev)    | CORS allow-list.                                                                       |
| `NEWS_ENABLE_FIFA`               | `0`                                                                                                    | Flip to `1` once a confirmed FIFA feed URL is in place.                                |
| `NEWS_ENABLE_GOAL`               | `0`                                                                                                    | Flip to `1` only when a Goal.com syndication partnership is in place.                  |

## Operations

- **Force a refresh**: `curl -X POST -H "Authorization: Bearer $NEWS_ADMIN_SECRET" https://news-dev.tournamental.com/v1/admin/refresh`
- **Source health**: `curl https://news-dev.tournamental.com/v1/sources | jq '.sources[] | {id, enabled, items: .health.itemCount, error: .health.lastError}'`
- **Live tail**: `pnpm --filter @vtorn/news-aggregator dev` and watch the structured log lines (`news scheduler tick` per cycle).

## Future work

- Wire the production `/api/news` proxy as a Cloudflare Pages Function on the marketing site.
- Add Brazilian Portuguese (Globo Esporte) and Italian (Gazzetta) sources once the existing matrix is steady.
- Per-team feeds (`/v1/news?tag=team:argentina`) once we have enough volume to make filtering meaningful.
- Optional Mem0-fed editorial layer (the orchestrator decides which items to feature on the home strip; the rest stay on `/news`).

## References

- [`apps/news-aggregator/`](../apps/news-aggregator/) — service code.
- [`apps/marketing/src/pages/news/index.astro`](../apps/marketing/src/pages/news/index.astro) — `/news` page.
- [`apps/web/components/home/NewsStrip.tsx`](../apps/web/components/home/NewsStrip.tsx) — bracket-app home strip.
- [docs/22-deployment-and-tunnels.md](22-deployment-and-tunnels.md) — port + tunnel registry.
