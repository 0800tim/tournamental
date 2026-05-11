# 23, Analytics, marketing insights, and engagement

> The instrumentation layer that lets the team see what users do, lets the bots decide who to engage with, and lets marketing target spend by impact instead of by gut. This doc covers both *what we measure* and *how we act on it*.

## Why this doc exists

Tim's standing direction: **users will scale from tens of thousands to hundreds of thousands to millions over three weeks**. We cannot improve what we cannot see, and we cannot ride a virality wave without knowing which features and which users drive it. Every code agent treats the events listed below as part of the contract, adding a feature without instrumentation is incomplete work.

## Architecture

Three planes, one schema.

```
            ┌──────────────────────────────────┐
            │          Browser / app           │
            │                                   │
            │  Google Tag Manager (single tag) │
            │   ├── GA4                        │
            │   ├── Meta Pixel                 │
            │   └── Tournamental dataLayer events     │
            │                                   │
            │  navigator.sendBeacon ───────────┐│
            └────────────┬─────────────────────┘│
                         │                       │
                         ▼                       │
                 api.tournamental.com               │
                 ┌────────────────┐              │
                 │ /v1/event      │◄─────────────┘
                 │  - validate    │
                 │  - rate-limit  │
                 │  - sign        │
                 └───────┬────────┘
                         │
                ┌────────┴────────┐
                ▼                 ▼
         Postgres (events)   Redis stream
         (durable, replay)   (real-time fan-out:
                              admin dash + bots)

         Postgres → ClickHouse (later, analytics warehouse)
         Redis    → Engagement scorer (real-time → bot policies)
```

**Three planes**:
1. **Client-side** (GA4 + Meta Pixel via GTM), for marketing attribution and "who's coming from where" insights. No PII in the dataLayer beyond what GA4/Meta accept.
2. **Server-side** (`/v1/event` on the Tournamental API), authoritative event log. Every browser-side event is also sent to our own API so we have ground truth even when ad-blockers nuke GTM.
3. **Engagement scorer**, a real-time stream consumer that updates each user's engagement score in Redis (with a Postgres mirror for durability). Bot-policy code reads from Redis.

**One schema**: the same event names, same field names everywhere. The dataLayer payload === the `/v1/event` body === the Postgres `events` table === the GA4 custom-event name. No translation layers.

## What Tim needs to provide

To turn this on:
- **GTM container ID**: `GTM-XXXXXX`. Tim creates a container in the Google Tag Manager UI under his account and pastes the ID into `.env`.
- **GA4 measurement ID**: `G-XXXXXXXXXX`. Created inside GA4; configured *via GTM* (not hardcoded), so we can swap GA4 properties without a code deploy.
- **Meta Pixel ID**: `XXXXXXXXXXXXXXX`. Same, configured via GTM.
- **(Optional, later) ClickHouse credentials**, if/when we set up the analytics warehouse.

That's all that's needed. Everything else (event names, dashboards, server logs, engagement scoring, bot policies) lives in this repo.

## Canonical event schema

These are the only event names we send. Adding one is a doc-update PR. Removing one is a major-version bump.

| Event name              | When fired                                                  | Required fields                                                  |
| ----------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `page_view`             | Every route change (SPA + initial)                          | `page_path`, `page_title`, `referrer`                            |
| `user_signup`           | Account creation completes                                  | `user_id`, `auth_method`, `referrer_user_id?`                     |
| `user_login`            | Successful auth                                              | `user_id`, `auth_method`                                         |
| `match_view_started`    | User opens a `/match/[id]` route                             | `match_id`, `tournament_id?`                                     |
| `match_view_completed`  | Page unload or match end, whichever first                    | `match_id`, `watched_pct`, `duration_ms`                          |
| `prediction_submitted`  | Prediction locked-in (server confirms)                       | `prediction_id`, `match_id`, `market`, `selection`, `stake_units` |
| `prediction_settled`    | Outcome resolved + points/tokens credited                    | `prediction_id`, `outcome`, `points_delta`, `tokens_delta`        |
| `leaderboard_viewed`    | Any leaderboard route mounted                                | `leaderboard_id`, `tournament_id?`                                |
| `tournament_joined`     | User opts into a tournament                                  | `tournament_id`, `entry_fee_units?`                               |
| `share_clicked`         | Share button activated                                       | `channel`, `surface`, `target_id`                                 |
| `referral_redeemed`     | New user activates a referral link                           | `referrer_user_id`, `new_user_id`, `bonus_tokens`                 |
| `bonus_token_earned`    | Tokens credited from any source                              | `source`, `tokens`, `reason_id?`                                  |
| `affiliate_clickout`    | User clicks through to a sportsbook affiliate                | `affiliate_id`, `match_id?`, `market?`                            |
| `client_error`          | Unhandled JS error captured by the renderer                  | `message`, `stack`, `route`                                       |

Common fields on every event (set by the SDK, not the caller):
- `event_id` (UUIDv7, dedup key for retries)
- `user_id` (or `anon_id` if not signed in)
- `session_id`
- `client_ts` (ISO 8601, ms)
- `server_ts` (set by `/v1/event` on receipt)
- `app_version` (build hash from `apps/web`)
- `env` (`dev` | `staging` | `prod`)
- `geo_country` (from Cloudflare `cf-ipcountry`; do not derive in the browser)

## Geographic data

Cloudflare adds an `cf-ipcountry` header on every request reaching the tunnel. The API echoes this into the `geo_country` field of every event. **No browser-side geolocation.** Country is enough for marketing splits; finer geography is opt-in only and reserved for tournament-locality features.

## SDK

`packages/analytics/` exports a tiny client with the canonical contract. Every workspace package that needs to fire events imports from here, never directly from `gtag()` / `fbq()`.

```ts
import { track } from '@vtorn/analytics';

track('prediction_submitted', {
  prediction_id,
  match_id,
  market: 'match_winner',
  selection: 'team_0',
  stake_units: 50,
});
```

Internally `track()`:
1. Pushes onto `window.dataLayer` for GTM (which forwards to GA4 + Meta Pixel via tags configured in the GTM UI).
2. Calls `navigator.sendBeacon('/v1/event', JSON.stringify(envelope))` so the server log gets the same event without depending on GTM at all.
3. In dev, also `console.debug`s the payload (gated on `NEXT_PUBLIC_ANALYTICS_DEBUG=1`).

## Server-side log

`POST /v1/event` on `apps/api`:
- Validates body against the schema.
- Rate-limits per IP (1000/min) and per `user_id` (10000/min).
- Stamps `server_ts`, `geo_country` from `cf-ipcountry`, signed with `event_id` (HMAC).
- Inserts into Postgres `events` table (partitioned by month).
- Publishes onto Redis stream `vtorn:events` for real-time consumers.

Schema (Postgres):

```sql
CREATE TABLE events (
  event_id     UUID PRIMARY KEY,
  user_id      UUID,
  anon_id      TEXT,
  session_id   UUID NOT NULL,
  event_name   TEXT NOT NULL,
  payload      JSONB NOT NULL,
  client_ts    TIMESTAMPTZ NOT NULL,
  server_ts    TIMESTAMPTZ NOT NULL DEFAULT now(),
  app_version  TEXT NOT NULL,
  env          TEXT NOT NULL,
  geo_country  TEXT,
  ip_hashed    BYTEA NOT NULL,         -- HMAC, not raw IP
  ua_hash      BYTEA NOT NULL          -- for bot detection, not raw UA
) PARTITION BY RANGE (server_ts);

CREATE INDEX events_user_idx ON events (user_id, server_ts DESC) WHERE user_id IS NOT NULL;
CREATE INDEX events_event_idx ON events (event_name, server_ts DESC);
CREATE INDEX events_geo_idx   ON events (geo_country, server_ts DESC);
CREATE INDEX events_payload_gin ON events USING gin (payload);
```

Storing **hashed IP and UA** keeps us audit-friendly without holding raw PII. Bot detection / ratelimiting reads from the hash (HMAC with a rotating server-side key).

## Engagement score

A real-time consumer of the Redis stream maintains per-user metrics in Redis hashes:

- `recency`: hours since last meaningful event (lower = better).
- `frequency`: events per day, EWMA smoothed.
- `prediction_rate`: predictions per match-view.
- `share_rate`: shares per session.
- `referral_count`: distinct users they've onboarded.
- `prediction_iq`: from doc 17 (rolling Brier score).

These combine into a single `engagement_score` (0–100) with a transparent formula in `apps/api/src/engagement/score.ts`. The score is read by:
- **Bot persona policy** (`apps/bots/`): selects the right outreach for each user (a lurker gets a gentle "predict the next match" prompt; a high-share user gets early access to a new feature with a "tell your friends" hook).
- **Admin dashboard**: shows distribution, top-N, by cohort.
- **Marketing exports**: weekly CSV to your CRM (whatever Tim picks, the export is tool-agnostic).

## Admin dashboard

Lives at `apps/admin/` (Next.js 14 + Tailwind + shadcn/ui), served on `admin.tournamental.com` (dev) / `admin.tournamental.com` (prod). Auth-walled to a small list of admin emails configured in `.env`.

Surfaces:

- **Live**: current concurrent viewers, predictions/min, latest signups, latest shares (all via Redis stream).
- **Today**: DAU, signups, predictions, conversion funnel (signup → first-match → first-prediction → first-share).
- **Last 7 / 30 days**: cohort retention, engagement-score distribution, geo heatmap, channel attribution from GA4 (read via the GA4 Data API), referral graph.
- **Per-user drilldown**: events timeline, engagement score breakdown, bot interactions sent, predictions placed (including IQ).
- **Bot policies**: switchboard for which engagement bands receive which outreach. Edits go through an audit-logged change.
- **Tournament admin**: create / lock / settle / void tournaments; force-recompute leaderboards.
- **Audit log**: every admin action with actor, target, before/after.

Performance budget: dashboard p95 TTFB < 400ms (cached endpoints), live counters update < 1s after the underlying event lands.

## Bot engagement loop

Bots never decide unilaterally. They consult the engagement scorer + a small set of declarative policies:

```yaml
# apps/bots/policies/lurker-prompt.yaml
when:
  engagement_score: { lt: 20 }
  events_in_last_24h: { gte: 1 }
  predictions_in_last_7d: 0
do:
  channel: telegram
  message: "There's a match in your tournament starting in 30 minutes. Want to predict the score?"
  cooldown: 72h
```

Marketing tunes policies in YAML, the bot loop applies them. All sends are logged as `bot_outreach_sent` events so they show up in the same dashboards.

## Marketing reporting

- **Weekly digest** (Monday 09:00 NZT, automated): cohort retention, top growth channels, top-engagement users, top-share triggers, leaderboard movements. Sent to a configurable list.
- **Quarterly contributor scoring** (per doc 19) reads the events table to compute downstream impact of each merged PR. Feeds Drips Network payouts.

## Privacy and consent

- **First-party consent banner** runs *before* GTM loads. No GTM, GA4, or Meta tag fires until the user accepts.
- Server-side events still fire (we control them) but are anonymised: `anon_id` only, `ip_hashed` only.
- Once the user signs up, we stitch `anon_id` → `user_id` server-side via the `user_signup` event payload.
- DSAR / right-to-be-forgotten: a single `DELETE /v1/me` endpoint nukes the user record + scrubs PII fields in `events` (we keep the row for aggregate analytics, with `user_id = NULL` and the payload PII fields stripped).
- Cookie list, retention windows, processor list are documented in `docs/24-privacy-and-consent.md` (TBD as a follow-up).

## Implementation roadmap

Phase 2 (in parallel with renderer hardening), in order of dependency:

1. `packages/analytics/`, the SDK + GTM + dataLayer + sendBeacon. Tiny.
2. `apps/api/`, `/v1/event` ingest + Postgres schema + Redis publish. Built alongside the auth surface.
3. `apps/admin/`, read-only first (live counters + today + 7-day). Editing controls (bot policies, tournaments) come second.
4. Engagement scorer (background worker reading the Redis stream). Lives in `apps/engagement-scorer/`.
5. ClickHouse warehouse + dbt models (when monthly event volume crosses the threshold where Postgres analytics queries get noisy, at ~50M events/month).

The agent breakdown for these is in [`docs/09-agent-task-breakdown.md`](09-agent-task-breakdown.md) (extend it as the lanes light up).

## What every PR is reviewed against

- Did this PR add a user-visible interaction? → Was the matching event fired?
- Did this PR add a new event name? → Doc updated, schema migration shipped, GTM tag noted in the PR body?
- Did this PR add raw PII (email, phone, raw IP, raw UA) to a log? → Reject. Hash, then log.
- Did this PR add a third-party tag? → Loaded via GTM, gated on consent, not blocking critical-path render?
- Did this PR add a bot outreach? → Policy YAML committed, dry-run sample shown in PR body, cooldown set?

These are part of the daily review checklist alongside the perf/caching items in [docs/22-deployment-and-tunnels.md](22-deployment-and-tunnels.md).
