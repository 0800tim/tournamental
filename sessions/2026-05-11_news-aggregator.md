# 2026-05-11 — news-aggregator — initial-build

**Status**: done
**Branch**: `feat/news-aggregator`
**Worktree**: `/home/clawdbot/clawdia/projects/vtorn-news`

## Goal

Stand up `apps/news-aggregator/` (a small Fastify TS service on port `:3402`) that polls public football-news RSS feeds, normalises items into a common shape, and exposes a JSON API consumed by:

- `vtourn.com/news` (a new Astro page on `apps/marketing`).
- A `<NewsStrip>` on the bracket-app home feed (`apps/web/app/page.tsx`).
- Any future surface that wants the live football news.

## Reading

- `CLAUDE.md` — agent ops protocol (worktrees, sessions, conventional commits, link-out ethics).
- `docs/22-deployment-and-tunnels.md` — port allocation (`:3402` reserved for this service).
- `apps/api/src/server.ts` — pattern for Fastify apps in this repo.
- `apps/marketing/src/pages/blog/index.astro` — pattern for marketing-site list pages.

## Source list (as shipped)

| Source       | Lang | Default  | Notes                                                                       |
| ------------ | ---- | -------- | --------------------------------------------------------------------------- |
| BBC Sport    | en   | enabled  | Public RSS, syndication-friendly.                                           |
| The Guardian | en   | enabled  | Public RSS; syndication policy permits headline + summary + link-out.       |
| ESPN         | en   | enabled  | Public RSS; FAQ permits headline + excerpt with link-out.                   |
| Marca        | es   | enabled  | Public RSS; surfaces South-American + La Liga depth in Spanish.             |
| FIFA         | en   | disabled | No stable public RSS today; descriptor in place, flip via `NEWS_ENABLE_FIFA=1`.  |
| Goal.com     | en   | disabled | Restrictive robots.txt; descriptor in place, flip via `NEWS_ENABLE_GOAL=1`. |

The disabled-by-default sources still surface in `/v1/sources` so the UI can show "coming soon" rather than 404.

## Ethics — link-out, not rehost

For every item we display only:
- Title
- 1–2 sentence summary, capped at 240 chars (paraphrased from RSS description)
- Source name
- Publish time
- Outbound link with `rel="noopener nofollow"` and `target="_blank"`

We never store or render the full article body. Source's branded artwork is only used when the feed itself surfaces a thumbnail (`media:thumbnail` / `media:content` / `enclosure`); otherwise we paint a source-coloured gradient placeholder. This is documented at `docs/49-news-aggregator.md`.

## What got built

### `apps/news-aggregator/`

- Fastify TS service, port `:3402`.
- `src/sources/{bbc,theguardian,espn,marca,fifa,goal}.ts` — one descriptor per source.
- `src/lib/{normalise,store,fetcher,hash}.ts` — shared logic.
- `src/scheduler.ts` — every 10 min refresh, single in-flight tick, configurable via `NEWS_REFRESH_INTERVAL_MIN`.
- `src/routes/{health,version,news}.ts` — Fastify routes.
- `src/swagger.ts` — no-op stub for the in-flight `feat/docs-hive-mind-and-swagger` agent to drop their wiring into without conflicting with this PR.
- 49 vitest cases (5 files): normaliser, store, fetcher (parse-fixture per source), scheduler concurrency, server smoke.
- JSONL append cache at `data/news-cache.jsonl` (gitignored), 30-day retention.
- ETag + `Cache-Control: public, s-maxage=120, stale-while-revalidate=600` on the list endpoint.

Routes: `GET /healthz`, `GET /v1/version`, `GET /v1/news?limit&since&source&lang&tag`, `GET /v1/news/:id`, `GET /v1/sources`, `POST /v1/admin/refresh` (bearer-gated by `NEWS_ADMIN_SECRET`).

### `apps/marketing` (Astro)

- `src/pages/news/index.astro` — public news feed page. SSR-renders the first batch from the news-aggregator, then a small inline script handles client-side filter chips and pagination via `/api/news`.
- `src/pages/api/news.ts` — Astro endpoint that proxies to the aggregator. (See "Production caveat" below.)
- `src/components/news/{NewsCard,NewsFilterChips,TimeAgo}.astro` — building blocks.
- `/news` added to the header nav (desktop + mobile drawer).

### `apps/web` (Next.js bracket app)

- `components/home/NewsStrip.tsx` — horizontal-scroll-on-mobile, 4-col-grid-on-desktop news strip.
- `components/home/news-strip.css` — styles, with skeleton shimmer + error fallback.
- `app/api/news/route.ts` — Next route handler that proxies to `:3402`.
- Wired into `app/page.tsx` between `<HeroCard>` and "Up next".

### Docs

- `docs/49-news-aggregator.md` — full source list, attribution, ethics, configuration, ops.
- `docs/22-deployment-and-tunnels.md` — added a row for `:3402` and the tunnel name.

## Manual smoke

```
NEWS_AGG_PORT=23402 pnpm --filter @vtorn/news-aggregator dev
curl -s http://localhost:23402/v1/version
curl -s 'http://localhost:23402/v1/news?limit=3' | jq '.items[].title'
curl -s 'http://localhost:23402/v1/sources' | jq '.sources[] | {id, enabled, items: .health.itemCount}'
```

Live test on this server returned: BBC=63 items, Guardian=53, ESPN=24, Marca=46. FIFA + Goal disabled.

Sample of `/v1/news?limit=3`:

- `The Guardian | Chelsea v Manchester City: Women's FA Cup semi-final – live`
- `The Guardian | West Ham United v Arsenal: Premier League – live`
- `ESPN | Mbappé ruled out of Clásico as Barça seek title`

## Quality gates

- `pnpm --filter @vtorn/news-aggregator typecheck` — clean.
- `pnpm --filter @vtorn/news-aggregator test` — 49/49 pass.
- `pnpm --filter @vtorn/marketing typecheck` — clean (existing warnings unchanged).
- `pnpm --filter @vtorn/marketing build` — clean (17 pages including `/news/`).
- `pnpm --filter @vtorn/web typecheck` — clean.
- `pnpm --filter @vtorn/web build` — fails on prerender of `/team/[code]` pages, **but this fails on `main` without my changes too**; pre-existing issue, unrelated to news. Verified by stash + rebuild on bare main.

## Coordination with concurrent agents

- `feat/docs-hive-mind-and-swagger` — added `src/swagger.ts` as a no-op stub so they can drop their wiring without merge conflict.
- `feat/knockout-flag-backgrounds` — touches `apps/web/components/bracket/`; I touched `apps/web/components/home/`, no overlap.
- `feat/player-profiles` — touches `apps/web/app/player/`; I touched `apps/web/app/api/news/`, no overlap.

## Production caveat (follow-up work)

The marketing site is currently fully-static (`output: 'static'` in `astro.config.mjs`). Astro's static build pre-renders `/api/news` once at build time, so in production the proxy will serve the build-time snapshot rather than live data. The `/news` page itself fetches client-side from `/api/news`, so the right move is to expose the news-aggregator publicly behind `news.vtourn.com` and/or provide a Cloudflare Pages Function at `functions/api/news.ts`. Both are doable in a follow-up PR; this one keeps scope tight.

## Next steps (parked in IDEAS.md candidates)

- Swap the marketing `/api/news` proxy for a Cloudflare Pages Function at deploy time.
- Add Brazilian Portuguese (Globo Esporte) and Italian (Gazzetta) sources once the matrix is steady.
- Per-team feeds via `tag=team:argentina` once volume justifies it.
- Editorial layer: Mem0-fed promotion of items into the home-strip.
