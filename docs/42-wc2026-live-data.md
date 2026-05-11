# 42, WC2026 live-data service

> The 2026 FIFA World Cup kicks off on **11 June 2026**. The renderer,
> push-notifications scheduler, and bracket-result settlement loop all
> need a single authoritative live-state stream. This doc describes that
> service.

## Scope

**`apps/wc2026-data`** owns three jobs now:

1. (existing, Python) **Canonical fixture builder**, produces
   `data/fifa-wc-2026/{fixtures,teams,host-cities,_meta}.json` from
   public sources. Offline / batch.
2. (existing, TS) **Online fixture refresh**, `scripts/fetch-fixtures.ts`
   nightly splices kickoff times into
   `packages/bracket-engine/data/fifa-wc-2026-fixtures.json`.
3. (new, TS) **Live match-state service**, Fastify HTTP service on
   `:3411` that streams real-time state via Server-Sent Events. Backed
   by a deterministic mock by default; SportRadar and API-Football are
   real-API adapter stubs gated by `WC2026_DATA_BACKEND`.

The renderer subscribes to the SSE stream for the match the user is
watching. The push scheduler polls `/v1/upcoming` every minute. The
settlement bridge is internal: when a match transitions to `final`, the
service POSTs the result to `apps/game`.

## Provider comparison

| Provider          | Pricing (May 2026)                                  | Polling    | Coverage                  | Notes                                              |
| ----------------- | --------------------------------------------------- | ---------- | ------------------------- | -------------------------------------------------- |
| **SportRadar**    | Trial: 1000 reqs / 30 days; Paid ~USD 200/mo        | 5 s (paid) | Full event + lineups      | Premium quality; tournament-grade.                 |
| **API-Football**  | Free 100/day; Pro USD 19/mo; Ultra USD 39/mo        | 30 s / 15 s| Goals, cards, lineups     | Cheaper; smaller event vocabulary.                 |
| **Mock**          | free                                                | 250 ms     | Deterministic synthetic   | Default; no network; CI / dev / smoke runs.        |

We default to **mock** in dev and CI. The orchestrator will pick the
real provider once the trial keys arrive, we recommend booking the
**API-Football Ultra** trial first (cheap, fast iteration) and keeping
**SportRadar** as a fallback for the knockouts where event richness
matters.

## Architecture

```
                                 ┌──────────────────────┐
                                 │   Renderer (web)     │
                                 │   subscribes via SSE │
                                 └─────────▲────────────┘
                                           │
                          GET /v1/match/:id/stream  (SSE)
                                           │
                                           │
┌──────────────────────┐         ┌─────────┴────────────┐
│  Real upstream API   │ ◀──────▶│  apps/wc2026-data    │
│  (SportRadar / AF)   │ poll    │  Fastify :3411       │
└──────────────────────┘         │  buildProvider()     │
                                 └─────────┬────────────┘
                                           │ on `final`
                                           │ POST /v1/match/:id/result
                                           │ x-game-internal-secret
                                           ▼
                                 ┌──────────────────────┐
                                 │  apps/game           │
                                 │  rescores brackets   │
                                 └──────────────────────┘
```

### Settlement-bridge state machine

```
   live snapshot arrives ─────────────▶ status === "final" ?
                                         │           │
                                         no          yes
                                         │           │
                                         ▼           ▼
                                       ignore   already settled?
                                                     │   │
                                                  yes│   │ no
                                                     │   │
                                                     ▼   ▼
                                                   skip  POST → game/v1/match/:id/result
                                                            │
                                                          2xx?
                                                          │  │
                                                       yes│  │ no
                                                          ▼  ▼
                                                    record  retry on next snapshot
                                                  settledVer
```

Idempotency key: `(matchId, settledVersion)`. We never double-post for
the same version. If a transient error returns non-2xx, we don't mark
as settled, the next snapshot retries the POST.

## Endpoints

```
GET  /healthz                                   liveness
GET  /v1/version                                version + backend info
GET  /v1/upcoming?limit=N                       next-N fixtures (≤ 104)
GET  /v1/match/:id                              one-shot LiveMatchState
GET  /v1/match/:id/stream                       Server-Sent Events
POST /v1/admin/reset (x-internal-secret)        reset mock state machine
```

### LiveMatchState shape

```ts
{
  matchId: "1",
  status: "live",                 // scheduled | live | ht | final | postponed | abandoned
  currentMinute: 23,
  homeScore: 1,
  awayScore: 0,
  scorers: [
    { teamId: "ARG", playerName: "Messi", minute: 23, type: "goal" }
  ],
  latestEvents: [
    { minute: 0,  type: "kickoff", description: "Kick-off" },
    { minute: 23, type: "goal",    description: "Goal for ARG, Messi (23')" }
  ],
  version: 24,                     // monotonic per match
  updatedAtUtc: "2026-06-11T19:23:01.000Z"
}
```

## Renderer SSE consumption

```ts
// apps/web, client-side
const ev = new EventSource("/wc2026-data/v1/match/1/stream");
ev.onmessage = (e) => {
  const state = JSON.parse(e.data);
  scoreHud.update(state.homeScore, state.awayScore);
  clockHud.update(state.currentMinute, state.status);
  for (const goal of state.scorers) renderGoalAnnouncement(goal);
};
ev.addEventListener("ready", (e) => {
  console.log("subscribed:", JSON.parse(e.data));
});
ev.onerror = () => {
  // Auto-reconnect is built into EventSource; nothing to do.
};
```

## Mock backend developer experience

The default backend is `mock`, seeded by
`data/fifa-wc-2026/fixtures.json`. It runs a small state machine per
match:

```
scheduled  ──tick──▶  live  ──crosses 45'──▶  ht
                                                 │
                                          ──tick──▶  live  ──crosses 90'──▶  final
```

- Goal probabilities are tuned for ~2.7 goals / 90 mins (FIFA average).
- Scorer pool is a fixed list (Messi, Mbappé, ...) deterministically
  selected by `(teamId + minute) mod pool.length`, same dev run will
  always produce the same goal sequence.
- `subscribeMatch` polls every 250 ms; each tick advances the clock by
  one minute. Set `WC2026_MINUTES_PER_TICK` (TODO) or pass via
  constructor for time-scale dev.

To force-reset the state machine without restarting the process:

```bash
curl -XPOST http://localhost:3411/v1/admin/reset \
     -H "x-internal-secret: $WC2026_DATA_ADMIN_SECRET"
```

## Environment

| Variable                       | Required for             | Default     | Notes                                            |
| ------------------------------ | ------------------------ | ----------- | ------------------------------------------------ |
| `WC2026_DATA_BACKEND`          | always                   | `mock`      | `mock | sportradar | apifootball`                |
| `WC2026_DATA_API_KEY`          | sportradar / apifootball |,           | Provider API key                                 |
| `WC2026_SPORTRADAR_BASE_URL`   | sportradar               | trial v4    | Override for a paid base URL                     |
| `WC2026_APIFOOTBALL_BASE_URL`  | apifootball              | v3 official | Override for a RapidAPI host                     |
| `WC2026_DATA_ADMIN_SECRET`     | optional                 |,           | x-internal-secret on /v1/admin/*                 |
| `WC2026_GAME_BASE_URL`         | enable settlement bridge |,           | Game service base URL                            |
| `WC2026_GAME_INTERNAL_SECRET`  | enable settlement bridge |,           | Sent as `x-game-internal-secret` to game service |
| `WC2026_TOURNAMENT_ID`         | settlement bridge        | `fifa-wc-2026` | Tournament identifier on the result POST     |
| `PORT`                         | optional                 | `3411`      | HTTP listen port                                 |

## Deployment

Reverse-proxied via `infra/cloudflared` under
`https://vtorn-data.aiva.nz`. Add the ingress rule to
`docs/22-deployment-and-tunnels.md` in the same PR that flips the
backend to a real provider.

## Operational notes

- **Cache policy.** `/v1/upcoming` carries `s-maxage=15, swr=60`. Other
  endpoints are `no-store`. SSE bypasses cache entirely.
- **Rate limiting.** Each real provider client respects upstream rate
  limits naturally via `pollIntervalMs`. We never poll faster than the
  provider's plan allows.
- **Resilience.** A transient 5xx from upstream is logged but does not
  break the SSE subscription, the next poll cycle retries.
- **Cost ceiling.** With API-Football Ultra at 15 s polling and a
  realistic 12-match concurrency in the group stage, we burn ~3500
  reqs/day, well under the 75 000/day plan.
